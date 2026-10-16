import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectFlutter, gradleFlavors, parsePubspec, yamlKeys } from '../src/run/flutter/detect'
import { findFlutterSdk, flutterEnv, flutterSpawn, parseFlutterVersion, type EnvDeps, type ExecResult } from '../src/run/flutter/env'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-flutter-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function fixture(files: Record<string, string>): string {
  const root = path.join(tmp, `f${n++}`)
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    if (!rel.endsWith('/')) writeFileSync(file, body)
  }
  mkdirSync(root, { recursive: true })
  return root
}

const pubspec = (name: string, extra = ''): string =>
  `name: ${name}\ndescription: "A thing # not a comment"\n\nenvironment:\n  sdk: ^3.5.0\n\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.2.0\n\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n${extra}`

const pubGetDone = (dir: string): Record<string, string> => ({
  [`${dir}pubspec.lock`]: '# lock',
  [`${dir}.dart_tool/package_config.json`]: '{}',
})

const app = (dir = '', name = 'demo'): Record<string, string> => ({
  [`${dir}pubspec.yaml`]: pubspec(name),
  [`${dir}.metadata`]: 'version:\n  revision: abc\n  channel: stable\n\nproject_type: app\n',
  [`${dir}lib/main.dart`]: 'void main() {}',
  [`${dir}android/app/build.gradle`]: 'android {}',
  [`${dir}ios/Runner/Info.plist`]: '',
  ...pubGetDone(dir),
})

describe('pubspec parsing', () => {
  it('reads flutter sdk dependency, name and plugin block', () => {
    expect(parsePubspec(pubspec('demo'))).toEqual({ name: 'demo', flutter: true, plugin: false })
    expect(parsePubspec('name: "dartish"\ndependencies:\n  path: any\ndev_dependencies:\n  flutter:\n    sdk: flutter\n')).toEqual({ name: 'dartish', flutter: false, plugin: false })
    expect(parsePubspec('name: p\ndependencies:\n  flutter: {sdk: flutter}\nflutter:\n  plugin:\n    platforms:\n      android:\n        package: x\n').plugin).toBe(true)
    expect(parsePubspec('name: p\ndependencies:\n  flutter: { sdk: flutter }\n').flutter).toBe(true)
  })

  it('skips block scalar bodies', () => {
    const keys = yamlKeys('name: a\ndescription: |\n  dependencies:\n  flutter:\nversion: 1.0.0\n')
    expect(keys.get('version')).toBe('1.0.0')
    expect(keys.has('dependencies')).toBe(false)
  })
})

describe('gradleFlavors', () => {
  it('reads Groovy blocks', () => {
    const text = `android {
  flavorDimensions "env"
  productFlavors {
    // staging { }
    dev {
      dimension "env"
      applicationIdSuffix ".dev"
      resValue "string", "app_name", "{dev}"
    }
    prod { dimension "env" }
  }
  buildTypes { release { } }
}`
    expect(gradleFlavors(text)).toEqual(['dev', 'prod'])
  })

  it('reads KTS create / register', () => {
    const text = `android {
  productFlavors {
    create("free") {
      dimension = "tier"
    }
    register("paid") { dimension = "tier" }
    create("bare")
  }
}`
    expect(gradleFlavors(text)).toEqual(['free', 'paid', 'bare'])
  })

  it('returns [] without productFlavors', () => {
    expect(gradleFlavors('android { defaultConfig { } }')).toEqual([])
  })
})

describe('detectFlutter', () => {
  it('standard app', async () => {
    const root = fixture(app())
    const [p] = await detectFlutter(root)
    expect(p).toEqual({
      kind: 'flutter',
      dir: root,
      name: 'demo',
      type: 'app',
      entrypoints: ['lib/main.dart'],
      platforms: ['android', 'ios'],
      flavors: [],
      needsPubGet: false,
      fvm: null,
    })
  })

  it('falls back without .metadata', async () => {
    const files = app()
    delete files['.metadata']
    expect((await detectFlutter(fixture(files)))[0].type).toBe('app')
    expect((await detectFlutter(fixture({ 'pubspec.yaml': pubspec('lib_only'), 'lib/src/a.dart': '' })))[0].type).toBe('package')
  })

  it('lists every lib/main*.dart, main.dart first', async () => {
    const root = fixture({ ...app(), 'lib/main_prod.dart': '', 'lib/main_dev.dart': '', 'lib/app.dart': '' })
    expect((await detectFlutter(root))[0].entrypoints).toEqual(['lib/main.dart', 'lib/main_dev.dart', 'lib/main_prod.dart'])
  })

  it('collects Android (Groovy + KTS) and iOS flavors', async () => {
    const groovy = fixture({
      ...app(),
      'android/app/build.gradle': 'android { productFlavors { dev { } prod { } } }',
      'ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme': '',
      'ios/Runner.xcodeproj/xcshareddata/xcschemes/dev.xcscheme': '',
      'ios/Runner.xcodeproj/xcshareddata/xcschemes/staging.xcscheme': '',
    })
    expect((await detectFlutter(groovy))[0].flavors).toEqual(['dev', 'prod', 'staging'])
    const files = app()
    delete files['android/app/build.gradle']
    const kts = fixture({ ...files, 'android/app/build.gradle.kts': 'android { productFlavors { create("qa") { } } }' })
    expect((await detectFlutter(kts))[0].flavors).toEqual(['qa'])
  })

  it('finds a monorepo app in mobile/', async () => {
    const root = fixture({ 'package.json': '{}', 'server/index.ts': '', ...app('mobile/') })
    const list = await detectFlutter(root)
    expect(list.map((p) => p.dir)).toEqual([path.join(root, 'mobile')])
  })

  it('finds two apps under apps/', async () => {
    const root = fixture({ ...app('apps/admin/', 'admin'), ...app('apps/client/', 'client'), 'node_modules/x/pubspec.yaml': pubspec('nope') })
    const list = await detectFlutter(root)
    expect(list.map((p) => p.name).sort()).toEqual(['admin', 'client'])
  })

  it('does not descend into skipped or deep folders', async () => {
    const root = fixture({
      ...app(),
      'build/x/pubspec.yaml': pubspec('b'),
      '.hidden/pubspec.yaml': pubspec('h'),
      'a/b/c/pubspec.yaml': pubspec('deep'),
      'ios/Pods/pubspec.yaml': pubspec('pods'),
    })
    expect((await detectFlutter(root)).map((p) => p.name)).toEqual(['demo'])
  })

  it('package', async () => {
    const root = fixture({ 'pubspec.yaml': pubspec('pkg'), '.metadata': 'project_type: package\n', 'lib/pkg.dart': '' })
    const [p] = await detectFlutter(root)
    expect(p.type).toBe('package')
    expect(p.needsPubGet).toBe(true)
  })

  it('plugin with example', async () => {
    const root = fixture({
      'pubspec.yaml': pubspec('plug', 'flutter:\n  plugin:\n    platforms:\n      android:\n        pluginClass: Plug\n'),
      '.metadata': 'project_type: plugin\n',
      'android/build.gradle': '',
      'lib/plug.dart': '',
      ...app('example/', 'plug_example'),
    })
    const list = await detectFlutter(root)
    expect(list.map((p) => [p.name, p.type])).toEqual([
      ['plug', 'plugin'],
      ['plug_example', 'app'],
    ])
    expect(list[0].example).toBe(path.join(root, 'example'))
  })

  it('plugin example found two levels down is listed once', async () => {
    const root = fixture({
      'packages/plug/pubspec.yaml': pubspec('plug', 'flutter:\n  plugin:\n    platforms: {}\n'),
      ...app('packages/plug/example/', 'plug_example'),
    })
    const list = await detectFlutter(root)
    expect(list.map((p) => p.name)).toEqual(['plug', 'plug_example'])
  })

  it('pure Dart project is typed dart', async () => {
    const root = fixture({ 'pubspec.yaml': 'name: cli\ndependencies:\n  args: ^2.0.0\n', 'bin/cli.dart': '' })
    const [p] = await detectFlutter(root)
    expect(p.type).toBe('dart')
    expect(p.platforms).toEqual([])
  })

  it('reads FVM pins', async () => {
    const fvm3 = fixture({ ...app(), '.fvmrc': '{"flutter": "3.24.3"}' })
    expect((await detectFlutter(fvm3))[0].fvm).toBe('3.24.3')
    const fvm2 = fixture({ ...app(), '.fvm/fvm_config.json': '{"flutterSdkVersion": "3.10.0"}' })
    expect((await detectFlutter(fvm2))[0].fvm).toBe('3.10.0')
  })

  it('needsPubGet: missing package_config, or pubspec newer than lock', async () => {
    const files = app()
    delete files['.dart_tool/package_config.json']
    expect((await detectFlutter(fixture(files)))[0].needsPubGet).toBe(true)
    const root = fixture(app())
    const old = new Date(Date.now() - 60_000)
    utimesSync(path.join(root, 'pubspec.lock'), old, old)
    expect((await detectFlutter(root))[0].needsPubGet).toBe(true)
    const fresh = fixture(app())
    utimesSync(path.join(fresh, 'pubspec.yaml'), old, old)
    expect((await detectFlutter(fresh))[0].needsPubGet).toBe(false)
  })

  it('TS-only folder → []', async () => {
    expect(await detectFlutter(fixture({ 'package.json': '{}', 'src/index.ts': '', 'apps/web/src/main.ts': '' }))).toEqual([])
    expect(await detectFlutter(path.join(tmp, 'missing'))).toEqual([])
  })
})

const VERSION_JSON = JSON.stringify({ frameworkVersion: '3.24.3', channel: 'stable', dartSdkVersion: '3.5.3', flutterRoot: '/x' })

function fakeDeps(files: string[], opts: { links?: Record<string, string>; dirs?: Record<string, string[]>; texts?: Record<string, string>; exec?: ExecResult } = {}) {
  const set = new Set(files)
  const calls: { file: string; args: string[]; verbatim?: boolean }[] = []
  const deps: EnvDeps = {
    isFile: (f) => set.has(f),
    isDir: () => false,
    readText: (f) => opts.texts?.[f] ?? null,
    readdir: (d) => opts.dirs?.[d] ?? [],
    realpath: (f) => opts.links?.[f] ?? f,
    async exec(file, args, o) {
      calls.push({ file, args, verbatim: o.windowsVerbatimArguments })
      return opts.exec ?? { ok: true, stdout: VERSION_JSON, stderr: '' }
    },
  }
  return { deps, calls }
}

const mac = { platform: 'darwin' as const, home: '/Users/me', env: {} as NodeJS.ProcessEnv }
const win = { platform: 'win32' as const, home: 'C:\\Users\\me', env: { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } as NodeJS.ProcessEnv }

describe('findFlutterSdk', () => {
  it('prefers a valid setting, accepting the bin folder', () => {
    const { deps } = fakeDeps(['/sdk/a/bin/flutter', '/sdk/env/bin/flutter'])
    expect(findFlutterSdk('/p', { ...mac, setting: '/sdk/a/bin', env: { FLUTTER_ROOT: '/sdk/env' } }, deps)).toMatchObject({ sdk: '/sdk/a', source: 'setting', issues: [] })
    const bad = findFlutterSdk('/p', { ...mac, setting: '/nope', env: { FLUTTER_ROOT: '/sdk/env' } }, deps)
    expect(bad).toMatchObject({ sdk: '/sdk/env', source: 'FLUTTER_ROOT' })
    expect(bad.issues).toEqual([{ code: 'flutter-setting-invalid', detail: '/nope' }])
  })

  it('keeps an SDK root named flutter, still accepts the picked executable', () => {
    const { deps } = fakeDeps(['C:\\src\\flutter\\bin\\flutter.bat'])
    expect(findFlutterSdk('C:\\p', { ...win, setting: 'C:\\src\\flutter' }, deps)).toMatchObject({ sdk: 'C:\\src\\flutter', source: 'setting', issues: [] })
    expect(findFlutterSdk('C:\\p', { ...win, setting: 'C:\\src\\flutter\\bin\\flutter.bat' }, deps)).toMatchObject({ sdk: 'C:\\src\\flutter', source: 'setting' })
  })

  it('uses the FVM pin from the cache, or reports it missing', () => {
    const texts = { '/p/.fvmrc': '{"flutter":"3.22.0"}' }
    const { deps } = fakeDeps(['/Users/me/fvm/versions/3.22.0/bin/flutter', '/sdk/env/bin/flutter'], { texts })
    expect(findFlutterSdk('/p', { ...mac, env: { FLUTTER_ROOT: '/sdk/env' } }, deps)).toMatchObject({ sdk: '/Users/me/fvm/versions/3.22.0', source: 'fvm', fvm: '3.22.0' })
    const custom = fakeDeps(['/cache/versions/3.22.0/bin/flutter'], { texts }).deps
    expect(findFlutterSdk('/p', { ...mac, env: { FVM_CACHE_PATH: '/cache' } }, custom).sdk).toBe('/cache/versions/3.22.0')
    const missing = findFlutterSdk('/p', { ...mac, env: { FLUTTER_ROOT: '/sdk/env' } }, fakeDeps(['/sdk/env/bin/flutter'], { texts }).deps)
    expect(missing).toMatchObject({ sdk: '/sdk/env', source: 'FLUTTER_ROOT', issues: [{ code: 'fvm-version-missing', detail: '3.22.0' }] })
  })

  it('uses the project .fvm/flutter_sdk link', () => {
    const { deps } = fakeDeps(['/p/.fvm/flutter_sdk/bin/flutter'])
    expect(findFlutterSdk('/p', mac, deps)).toMatchObject({ sdk: '/p/.fvm/flutter_sdk', source: 'fvm', fvm: null })
  })

  it('walks PATH and resolves symlinks to the SDK', () => {
    const { deps } = fakeDeps(['/opt/homebrew/bin/flutter', '/opt/homebrew/Caskroom/flutter/3.24.3/flutter/bin/flutter'], {
      links: { '/opt/homebrew/bin/flutter': '/opt/homebrew/Caskroom/flutter/3.24.3/flutter/bin/flutter' },
    })
    expect(findFlutterSdk('/p', { ...mac, env: { PATH: 'relative:/usr/bin:/opt/homebrew/bin' } }, deps)).toMatchObject({
      sdk: '/opt/homebrew/Caskroom/flutter/3.24.3/flutter',
      source: 'path',
    })
  })

  it('finds flutter.bat on the Windows PATH', () => {
    const { deps } = fakeDeps(['D:\\tools\\flutter\\bin\\flutter.bat'])
    const env = { ...win.env, Path: 'C:\\Windows;D:\\tools\\flutter\\bin' }
    expect(findFlutterSdk('C:\\p', { ...win, env }, deps)).toMatchObject({ sdk: 'D:\\tools\\flutter', source: 'path' })
  })

  it('falls back to OS defaults', () => {
    expect(findFlutterSdk('C:\\p', win, fakeDeps(['C:\\Users\\me\\AppData\\Local\\flutter\\bin\\flutter.bat']).deps)).toMatchObject({ source: 'default' })
    const cask = fakeDeps(['/opt/homebrew/Caskroom/flutter/3.24.3/flutter/bin/flutter'], { dirs: { '/opt/homebrew/Caskroom/flutter': ['3.19.0', '3.24.3'] } })
    expect(findFlutterSdk('/p', mac, cask.deps).sdk).toBe('/opt/homebrew/Caskroom/flutter/3.24.3/flutter')
    expect(findFlutterSdk('/p', mac, fakeDeps([]).deps)).toEqual({ sdk: null, source: null, fvm: null, issues: [{ code: 'flutter-missing' }] })
  })
})

describe('flutterEnv', () => {
  it('runs --version --machine and parses it', async () => {
    const { deps, calls } = fakeDeps(['/sdk/bin/flutter'])
    const env = await flutterEnv('/p', { ...mac, env: { FLUTTER_ROOT: '/sdk' } }, deps)
    expect(env).toEqual({ kind: 'flutter', sdk: '/sdk', source: 'FLUTTER_ROOT', version: '3.24.3', dart: '3.5.3', channel: 'stable', fvm: false, issues: [] })
    expect(calls[0]).toMatchObject({ file: '/sdk/bin/flutter', args: ['--version', '--machine'] })
  })

  it('reports a failed version call', async () => {
    const { deps } = fakeDeps(['/sdk/bin/flutter'], { exec: { ok: false, stdout: '', stderr: 'boom' } })
    const env = await flutterEnv('/p', { ...mac, env: { FLUTTER_ROOT: '/sdk' } }, deps)
    expect(env.version).toBeNull()
    expect(env.issues).toEqual([{ code: 'flutter-version-failed', detail: '/sdk' }])
  })

  it('reports a missing SDK without exec', async () => {
    const { deps, calls } = fakeDeps([])
    expect((await flutterEnv('/p', mac, deps)).issues).toEqual([{ code: 'flutter-missing' }])
    expect(calls).toEqual([])
  })

  it('goes through cmd.exe on Windows', async () => {
    const { deps, calls } = fakeDeps(['C:\\src\\flutter\\bin\\flutter.bat'])
    const env = await flutterEnv('C:\\p', win, deps)
    expect(env.source).toBe('default')
    expect(calls[0].file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(calls[0].verbatim).toBe(true)
  })

  it('does not execute an SDK inside the project unless trusted', async () => {
    const { deps, calls } = fakeDeps(['/p/.fvm/flutter_sdk/bin/flutter'])
    const env = await flutterEnv('/p', mac, deps)
    expect(env).toMatchObject({ sdk: '/p/.fvm/flutter_sdk', source: 'fvm', version: null, issues: [{ code: 'fvm-local-unverified', detail: '/p/.fvm/flutter_sdk' }] })
    expect(calls).toEqual([])
    expect((await flutterEnv('/p', { ...mac, trusted: true }, deps)).version).toBe('3.24.3')
    expect(calls).toHaveLength(1)
  })

  it('follows links: an SDK resolving into the repo root is not executed passively', async () => {
    const { deps, calls } = fakeDeps(['/cache/versions/3.22.0/bin/flutter'], {
      links: { '/cache/versions/3.22.0': '/repo/tools/flutter' },
      texts: { '/repo/app/.fvmrc': '{"flutter":"3.22.0"}' },
    })
    const opts = { ...mac, env: { FVM_CACHE_PATH: '/cache' } }
    expect((await flutterEnv('/repo/app', { ...opts, repoRoot: '/repo' }, deps)).issues.map((i) => i.code)).toEqual(['fvm-local-unverified'])
    expect(calls).toEqual([])
    expect((await flutterEnv('/repo/app', opts, deps)).version).toBe('3.24.3')
  })

  it('tolerates banner text around the JSON', () => {
    expect(parseFlutterVersion(`Welcome to Flutter!\n${VERSION_JSON}\n`)).toEqual({ version: '3.24.3', dart: '3.5.3', channel: 'stable' })
    expect(parseFlutterVersion('{"dartSdkVersion":"3.7.0 (build 3.7.0-1.0.dev)","frameworkVersion":"3.29.0"}')).toEqual({ version: '3.29.0', dart: '3.7.0', channel: null })
    expect(parseFlutterVersion('nope')).toBeNull()
  })
})

describe('flutterSpawn', () => {
  it('spawns the script directly on posix', () => {
    expect(flutterSpawn('/sdk', ['run', '-d', 'my phone'], 'darwin')).toEqual({ file: '/sdk/bin/flutter', args: ['run', '-d', 'my phone'] })
  })

  it('quotes for cmd.exe on Windows', () => {
    const spec = flutterSpawn('C:\\Program Files\\flutter', ['run', '--dart-define=A=b c', 'x&calc'], 'win32', { SystemRoot: 'C:\\Windows' })
    expect(spec.file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(spec.windowsVerbatimArguments).toBe(true)
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    const line = spec.args[3]
    expect(line.startsWith('"C:\\Program^ Files\\flutter\\bin\\flutter.bat ')).toBe(true)
    expect(line).toContain('^^^"x^^^&calc^^^"')
    expect(line).not.toMatch(/[^^]&/)
  })
})
