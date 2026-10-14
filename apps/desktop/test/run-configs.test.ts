import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AndroidProject, AndroidRunConfig, CustomRunConfig, FlutterProject, FlutterRunConfig, RunConfig } from '@ccm/shared'
import { quoteForDisplay, splitArgs, substitute } from '../src/run/args'
import { androidGradleArgs, customArgv, flutterArgv, previewCommand } from '../src/run/command'
import { cleanRunConfig, defaultConfigs, RunConfigStore } from '../src/run/configs'
import { importIntellij, importVscode, stripJsonc } from '../src/run/importers'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-runcfg-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function freshRoot(): string {
  const dir = path.join(tmp, `repo${n++}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function put(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

const ROOT = path.join(tmp, 'ws')
const APP = path.join(ROOT, 'my app')

function flutterCfg(over: Partial<FlutterRunConfig> = {}): FlutterRunConfig {
  return { id: 'f1', name: 'main.dart', type: 'flutter', cwd: APP, shared: false, env: {}, beforeLaunch: [], entrypoint: 'lib/main.dart', device: 'selected', mode: 'debug', flavor: '', args: '', attachArgs: '', ...over }
}

function androidCfg(over: Partial<AndroidRunConfig> = {}): AndroidRunConfig {
  return { id: 'a1', name: 'app', type: 'android', cwd: ROOT, shared: false, env: {}, beforeLaunch: [], module: ':app', variant: 'debug', device: 'selected', args: '', ...over }
}

describe('splitArgs', () => {
  it.each([
    ['', []],
    ['  a   b\tc ', ['a', 'b', 'c']],
    ['--dart-define=A="x y"', ['--dart-define=A=x y']],
    ['"a b" c', ['a b', 'c']],
    ["'a \"b\" c'", ['a "b" c']],
    ['"say \\"hi\\""', ['say "hi"']],
    ['"C:\\Program Files\\x" C:\\a\\b', ['C:\\Program Files\\x', 'C:\\a\\b']],
    ['"" x', ['', 'x']],
    ['a"b c"d', ['ab cd']],
    ['$(rm -rf /) ; && |', ['$(rm', '-rf', '/)', ';', '&&', '|']],
    ['"unterminated x', ['unterminated x']],
  ])('%j', (input, out) => {
    expect(splitArgs(input)).toEqual(out)
  })

  it('quoteForDisplay round-trips through splitArgs', () => {
    const argv = ['C:\\flutter\\bin\\flutter.bat', 'run', '-t', 'lib/main.dart', 'a b', 'say "hi"', '']
    const shown = quoteForDisplay(argv)
    expect(shown).toBe('C:\\flutter\\bin\\flutter.bat run -t lib/main.dart "a b" "say \\"hi\\"" ""')
    expect(splitArgs(shown)).toEqual(argv)
  })
})

describe('substitute', () => {
  const vars = { projectDir: '/p', workspaceDir: '/w', env: { HOME: '/home/u', EMPTY: '' } }
  it('known variables only', () => {
    expect(substitute('${projectDir}/env.json', vars)).toBe('/p/env.json')
    expect(substitute('${workspaceDir}:${env:HOME}', vars)).toBe('/w:/home/u')
    expect(substitute('${env:MISSING}x', vars)).toBe('x')
    expect(substitute('${workspaceFolder} ${env:1BAD} $HOME %HOME% ${projectdir}', vars)).toBe('${workspaceFolder} ${env:1BAD} $HOME %HOME% ${projectdir}')
  })
})

describe('command building', () => {
  const ctx = { flutterFile: '/sdk/bin/flutter', projectDir: APP, workspaceDir: ROOT, env: { TOKEN: 't' } }

  it('flutter argv order across mode / flavor / args', () => {
    expect(flutterArgv(flutterCfg(), 'emulator-5554', ctx)).toEqual(['/sdk/bin/flutter', 'run', '--machine', '-d', 'emulator-5554', '-t', 'lib/main.dart', '--debug'])
    expect(flutterArgv(flutterCfg({ mode: 'release', flavor: 'prod', args: '--dart-define-from-file="env files/prod.json" --dart-define=T=${env:TOKEN}' }), 'chrome', ctx)).toEqual([
      '/sdk/bin/flutter', 'run', '--machine', '-d', 'chrome', '-t', 'lib/main.dart', '--flavor', 'prod', '--release', '--dart-define-from-file=env files/prod.json', '--dart-define=T=t',
    ])
    expect(flutterArgv(flutterCfg({ mode: 'profile', device: 'pinned', args: '--x=${projectDir}' }), 'ignored', ctx)).toEqual([
      '/sdk/bin/flutter', 'run', '--machine', '-d', 'pinned', '-t', 'lib/main.dart', '--profile', `--x=${APP}`,
    ])
    expect(flutterArgv(flutterCfg(), null, ctx)).not.toContain('-d')
  })

  it('android gradle task and custom argv', () => {
    expect(androidGradleArgs(androidCfg())).toEqual([':app:assembleDebug', '--console=plain'])
    expect(androidGradleArgs(androidCfg({ module: ':feature:demo', variant: 'freeRelease', args: '--offline -Pa="b c"' }))).toEqual([
      ':feature:demo:assembleFreeRelease', '--console=plain', '--offline', '-Pa=b c',
    ])
    const custom: CustomRunConfig = { id: 'c', name: 'c', type: 'custom', cwd: ROOT, shared: false, env: { M: 'dev' }, beforeLaunch: [], command: 'fvm flutter run --flavor ${env:M} -t "lib/main dev.dart"' }
    expect(customArgv(custom)).toEqual(['fvm', 'flutter', 'run', '--flavor', 'dev', '-t', 'lib/main dev.dart'])
  })

  it('preview validation codes', () => {
    const have = new Set([path.resolve(APP, 'lib/main.dart'), path.resolve(APP, 'env.json')])
    const exists = (p: string): boolean => have.has(path.resolve(p))
    const project: FlutterProject = { kind: 'flutter', dir: APP, name: 'app', type: 'app', entrypoints: ['lib/main.dart'], platforms: ['android'], flavors: ['dev'], needsPubGet: false, fvm: null }
    const base = { executable: '/sdk/bin/flutter', deviceId: 'd1', workspaceDir: ROOT, env: {}, project, exists }

    const ok = previewCommand(flutterCfg({ flavor: 'dev', args: '--dart-define-from-file=env.json' }), base)
    expect(ok.errors).toEqual([])
    expect(ok.argv[0]).toBe('/sdk/bin/flutter')
    expect(ok.command).toBe('/sdk/bin/flutter run --machine -d d1 -t lib/main.dart --flavor dev --debug --dart-define-from-file=env.json')

    const bad = previewCommand(flutterCfg({ entrypoint: 'lib/nope.dart', flavor: 'prod', args: '--dart-define-from-file=env.json --dart-define-from-file missing.json --dart-define-from-file=${projectDir}/abs.json' }), { ...base, deviceId: null })
    expect(bad.errors).toEqual([
      { code: 'entrypoint-missing', detail: 'lib/nope.dart' },
      { code: 'define-file-missing', detail: 'missing.json' },
      { code: 'define-file-missing', detail: `${APP}/abs.json` },
      { code: 'flavor-unknown', detail: 'prod' },
      { code: 'device-missing' },
    ])
    expect(previewCommand(flutterCfg({ flavor: 'any' }), { ...base, project: { ...project, flavors: [] } }).errors).toEqual([])

    const android: AndroidProject = { kind: 'android', dir: ROOT, name: 'r', framework: 'native', status: 'runnable', modules: [{ path: ':app', dir: path.join(ROOT, 'app'), type: 'application', manifest: null, launcher: true, guessed: false }] }
    const a = previewCommand(androidCfg({ module: ':lib', device: 'emulator-5554' }), { ...base, executable: path.join(ROOT, 'gradlew.bat'), project: android })
    expect(a.argv).toEqual([path.join(ROOT, 'gradlew.bat'), ':lib:assembleDebug', '--console=plain'])
    expect(a.errors).toEqual([{ code: 'module-unknown', detail: ':lib' }])
    expect(previewCommand(androidCfg(), { ...base, deviceId: null, project: android }).errors).toEqual([{ code: 'device-missing' }])

    const empty = previewCommand({ id: 'c', name: 'c', type: 'custom', cwd: ROOT, shared: false, env: {}, beforeLaunch: [], command: '   ' }, base)
    expect(empty.errors).toEqual([{ code: 'command-empty' }])
  })
})

describe('cleanRunConfig', () => {
  it('accepts a valid config and normalizes', () => {
    const c = cleanRunConfig({ ...flutterCfg(), entrypoint: 'lib\\main.dart', beforeLaunch: [' dart run build_runner build ', ''], shared: 'yes' }, ROOT)
    expect(c).toMatchObject({ entrypoint: 'lib/main.dart', beforeLaunch: ['dart run build_runner build'], shared: false })
    expect(cleanRunConfig({ ...androidCfg(), variant: undefined }, ROOT)).toMatchObject({ variant: 'debug' })
  })

  it('cwd inside root, case-insensitive on win32', () => {
    expect(cleanRunConfig(flutterCfg({ cwd: path.join(tmp, 'other') }), ROOT)).toBeNull()
    expect(cleanRunConfig(flutterCfg({ cwd: path.join(ROOT, '..', 'ws2') }), ROOT)).toBeNull()
    expect(cleanRunConfig(flutterCfg({ cwd: 'relative' }), ROOT)).toBeNull()
    if (process.platform === 'win32') expect(cleanRunConfig(flutterCfg({ cwd: APP.toUpperCase() }), ROOT)).not.toBeNull()
  })

  it.each<[string, Record<string, unknown>]>([
    ['bad id', { id: 'a b' }],
    ['long id', { id: 'x'.repeat(65) }],
    ['long name', { name: 'n'.repeat(81) }],
    ['blank name', { name: '  ' }],
    ['entry ..', { entrypoint: '../x.dart' }],
    ['entry abs', { entrypoint: '/x.dart' }],
    ['entry drive', { entrypoint: 'C:x.dart' }],
    ['mode', { mode: 'fast' }],
    ['flavor', { flavor: 'a-b' }],
    ['env key', { env: { '1A': 'x' } }],
    ['env value', { env: { A: 1 } }],
    ['env count', { env: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`K${i}`, 'v'])) }],
    ['before count', { beforeLaunch: Array.from({ length: 11 }, () => 'x') }],
    ['before length', { beforeLaunch: ['x'.repeat(501)] }],
    ['args length', { args: 'x'.repeat(2001) }],
    ['device', { device: 'a b' }],
    ['type', { type: 'web' }],
  ])('rejects %s', (_label, over) => {
    expect(cleanRunConfig({ ...flutterCfg(), ...over }, ROOT)).toBeNull()
  })

  it('android / custom field rules', () => {
    expect(cleanRunConfig(androidCfg({ module: 'app' }), ROOT)).toBeNull()
    expect(cleanRunConfig(androidCfg({ variant: 'free-debug' }), ROOT)).toBeNull()
    expect(cleanRunConfig({ id: 'c', name: 'c', type: 'custom', cwd: ROOT, command: 'x'.repeat(2001) }, ROOT)).toBeNull()
    expect(cleanRunConfig({ id: 'c', name: 'c', type: 'custom', cwd: ROOT, command: '' }, ROOT)).toMatchObject({ command: '', env: {}, beforeLaunch: [] })
  })
})

describe('RunConfigStore', () => {
  it('save / move between sides / delete; shared wins on id clash', () => {
    const root = freshRoot()
    const app = path.join(root, 'app')
    const store = new RunConfigStore(path.join(tmp, `data${n}`))
    const sharedDir = path.join(root, '.agent-monitor', 'run')

    const a = store.save(root, flutterCfg({ id: 'a', name: 'zeta', cwd: app }))!
    const b = store.save(root, { ...flutterCfg({ name: 'alpha', cwd: app }), id: undefined })!
    expect(b.id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(store.list(root).map((c) => c.name)).toEqual(['alpha', 'zeta'])
    expect(existsSync(sharedDir)).toBe(false)
    expect(JSON.parse(readFileSync(store.personalFile(root), 'utf8'))).toHaveLength(2)

    store.save(root, { ...a, shared: true })
    expect(JSON.parse(readFileSync(store.personalFile(root), 'utf8'))).toHaveLength(1)
    const sharedJson = JSON.parse(readFileSync(path.join(sharedDir, 'a.json'), 'utf8')) as Record<string, unknown>
    expect(sharedJson.cwd).toBe('app')
    expect(sharedJson.id).toBeUndefined()
    expect(store.list(root).find((c) => c.id === 'a')).toMatchObject({ shared: true, cwd: app })

    store.save(root, { ...a, shared: false, name: 'back' })
    expect(existsSync(path.join(sharedDir, 'a.json'))).toBe(false)
    expect(store.list(root).find((c) => c.id === 'a')).toMatchObject({ shared: false, name: 'back' })

    put(path.join(sharedDir, 'a.json'), JSON.stringify({ ...flutterCfg({ name: 'team', cwd: 'app' }), id: 'ignored' }))
    put(path.join(sharedDir, 'bad.json'), '{oops')
    put(path.join(sharedDir, 'evil.json'), JSON.stringify({ ...flutterCfg({ name: 'evil', cwd: '../../outside' }) }))
    const list = store.list(root)
    expect(list.map((c) => `${c.id}:${c.name}:${c.shared}`)).toEqual([`${b.id}:alpha:false`, 'a:team:true'])

    expect(store.delete(root, 'a')).toBe(true)
    expect(store.list(root).map((c) => c.id)).toEqual([b.id])
    expect(store.delete(root, 'a')).toBe(false)
    expect(store.delete(root, '../x')).toBe(false)
    expect(store.save(root, { ...flutterCfg(), cwd: path.join(tmp, 'elsewhere') })).toBeNull()
    expect(readdirSync(path.dirname(store.personalFile(root))).some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('personal file keyed per project', () => {
    const store = new RunConfigStore(path.join(tmp, 'dataK'))
    const r1 = freshRoot()
    const r2 = freshRoot()
    expect(store.personalFile(r1)).not.toBe(store.personalFile(r2))
    if (process.platform === 'win32') expect(store.personalFile(r1.toUpperCase())).toBe(store.personalFile(r1))
    store.save(r1, flutterCfg({ id: 'x', cwd: r1 }))
    expect(store.list(r2)).toEqual([])
  })
})

describe('defaultConfigs', () => {
  const flutter = (dir: string, over: Partial<FlutterProject> = {}): FlutterProject => ({
    kind: 'flutter', dir, name: path.basename(dir), type: 'app', entrypoints: ['lib/main.dart', 'lib/main_dev.dart'], platforms: ['android'], flavors: [], needsPubGet: false, fvm: null, ...over,
  })
  const android: AndroidProject = {
    kind: 'android', dir: path.join(ROOT, 'native'), name: 'native', framework: 'native', status: 'runnable',
    modules: [
      { path: ':app', dir: '', type: 'application', manifest: null, launcher: true, guessed: false },
      { path: ':core', dir: '', type: 'library', manifest: null, launcher: false, guessed: false },
      { path: ':demo', dir: '', type: 'unknown', manifest: null, launcher: true, guessed: true },
    ],
  }

  it('one per entrypoint, flavors only when present, android runnable modules', () => {
    const out = defaultConfigs([flutter(APP), android, { ...android, framework: 'flutter', dir: path.join(APP, 'android') }, flutter(path.join(ROOT, 'pkg'), { type: 'package' })], ROOT)
    expect(out.map((c) => c.name)).toEqual(['main.dart', 'main_dev.dart', 'app', 'demo'])
    expect(out.slice(2).map((c) => (c as AndroidRunConfig).variant)).toEqual(['debug', 'debug'])
  })

  it('labels with folder when several apps; flavors on main entrypoint; stable ids', () => {
    const mobile = path.join(ROOT, 'mobile')
    const projects = [flutter(mobile, { flavors: ['dev', 'prod'] }), flutter(path.join(ROOT, 'admin'), { entrypoints: ['lib/main.dart'] })]
    const out = defaultConfigs(projects, ROOT)
    expect(out.map((c) => c.name)).toEqual(['main.dart (mobile)', 'main_dev.dart (mobile)', 'main.dart (mobile, dev)', 'main.dart (mobile, prod)', 'main.dart (admin)'])
    expect((out[2] as FlutterRunConfig).flavor).toBe('dev')
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length)
    expect(defaultConfigs(projects, ROOT).map((c) => c.id)).toEqual(out.map((c) => c.id))
    expect(out.every((c: RunConfig) => cleanRunConfig(c, ROOT) !== null)).toBe(true)
  })
})

describe('importers', () => {
  it('IntelliJ .run + .idea run configurations', () => {
    const root = freshRoot()
    put(path.join(root, 'mobile', 'pubspec.yaml'), 'name: m\n')
    put(path.join(root, '.run', 'dev.run.xml'), `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="Dev &amp; QA" type="FlutterRunConfigurationType" factoryName="Flutter">
    <option name="additionalArgs" value="--dart-define-from-file=&quot;env dev.json&quot;" />
    <option name="buildFlavor" value="dev" />
    <option name="filePath" value="$PROJECT_DIR$/mobile/lib/main_dev.dart" />
    <envs>
      <env name="API_URL" value="http://localhost:8080" />
    </envs>
    <method v="2" />
  </configuration>
</component>`)
    put(path.join(root, '.idea', 'runConfigurations', 'app.xml'), `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="app" type="AndroidRunConfigurationType" factoryName="Android App">
    <module name="MyApp.feature.demo.main" />
  </configuration>
  <configuration name="tests" type="JUnit" />
</component>`)
    put(path.join(root, '.run', 'bad.run.xml'), '<configuration name="x" type="FlutterRunConfigurationType"><option name="filePath" value="/etc/passwd.dart"/></configuration>')
    const before = readFileSync(path.join(root, '.run', 'dev.run.xml'), 'utf8')
    const out = importIntellij(root)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ type: 'flutter', name: 'Dev & QA', cwd: path.join(root, 'mobile'), entrypoint: 'lib/main_dev.dart', flavor: 'dev', args: '--dart-define-from-file="env dev.json"', env: { API_URL: 'http://localhost:8080' }, shared: false })
    expect(out[1]).toMatchObject({ type: 'android', name: 'app', module: ':feature:demo', cwd: root, variant: 'debug' })
    expect(out[0]!.id).toMatch(/^imp-[0-9a-f]{16}$/)
    expect(importIntellij(root).map((c) => c.id)).toEqual(out.map((c) => c.id))
    expect(out[0]!.id).not.toBe(out[1]!.id)
    expect(readFileSync(path.join(root, '.run', 'dev.run.xml'), 'utf8')).toBe(before)
    expect(importIntellij(freshRoot())).toEqual([])
  })

  it('VS Code launch.json (JSONC)', () => {
    const root = freshRoot()
    put(path.join(root, 'app', 'pubspec.yaml'), 'name: a\n')
    put(path.join(root, '.vscode', 'launch.json'), `{
  // comment
  "version": "0.2.0",
  "configurations": [
    /* block */
    {
      "name": "app (profile)",
      "type": "dart",
      "request": "launch",
      "cwd": "\${workspaceFolder}/app",
      "program": "lib/main_dev.dart",
      "toolArgs": ["--dart-define", "URL=http://x//y", "--flavor", "dev"],
      "args": ["a b"],
      "deviceId": "chrome",
      "flutterMode": "profile",
      "env": { "A": "1", "B": 2, "C": {} },
    },
    { "name": "node", "type": "node", "program": "x.js" },
    { "name": "default", "type": "dart" },
  ],
}`)
    const out = importVscode(root)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      name: 'app (profile)', cwd: path.join(root, 'app'), entrypoint: 'lib/main_dev.dart', device: 'chrome', mode: 'profile',
      env: { A: '1', B: '2' }, shared: false,
    })
    expect(splitArgs((out[0] as FlutterRunConfig).args)).toEqual(['--dart-define', 'URL=http://x//y', '--flavor', 'dev', 'a b'])
    expect(out[1]).toMatchObject({ name: 'default', cwd: root, entrypoint: 'lib/main.dart', device: 'selected', mode: 'debug' })
    expect(importVscode(freshRoot())).toEqual([])
  })

  it('drops env keys that redirect what runs', () => {
    const root = freshRoot()
    put(path.join(root, '.vscode', 'launch.json'), JSON.stringify({ configurations: [{ name: 'x', type: 'dart', env: { PATH: '/evil', NODE_OPTIONS: '-r x', DYLD_INSERT_LIBRARIES: 'a', Path: 'b', API: '1' } }] }))
    expect(importVscode(root)[0]!.env).toEqual({ API: '1' })
  })

  it('stripJsonc keeps comment-like text inside strings', () => {
    expect(JSON.parse(stripJsonc('{"a": "// no", "b": "/* no */", "c": "q\\"//", /* x */ "d": [1, 2,], }'))).toEqual({ a: '// no', b: '/* no */', c: 'q"//', d: [1, 2] })
  })
})
