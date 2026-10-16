import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AndroidEnv, FlutterProject, RunDevice, RunEvent } from '@ccm/shared'
import { createLogMasker } from '../src/log-mask'
import { defaultConfigs, cleanTemplates } from '../src/run/configs'
import { flutterMachineMode } from '../src/run/custom'
import { findFlutterSdk, projectSdkKey, sdkSettings, type EnvDeps } from '../src/run/flutter/env'
import { RunManager } from '../src/run/sessions'
import { androidToolchain, flutterToolchain, parseDoctorMachine, parseDoctorText, type ToolchainExec } from '../src/run/toolchain'
import type { DeviceService, RunContext, Runner } from '../src/run/types'
import { DETECT_FILE, ProjectWatchers, watchDirs } from '../src/run/watch'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-run-gaps-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

describe('createLogMasker', () => {
  const mask = createLogMasker('C:\\Users\\dev', 'win32')
  it('masks home and tokens, keeps Gradle task names and class names', () => {
    expect(mask('at C:\\Users\\dev\\app\\Main.kt and c:/users/dev/x')).toBe('at ~\\app\\Main.kt and ~/x')
    expect(mask('token ghp_abcdefghijklmnopqrstuvwxyz123456')).toBe('token [masked]')
    expect(mask('> Task :app:generateDebugAndroidTestResValues2')).toContain('generateDebugAndroidTestResValues2')
    expect(mask('at com.example.feature.FeatureLoginViewModelImplementation2.run')).toContain('FeatureLoginViewModelImplementation2')
    expect(mask('key aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3')).toBe('key [masked]')
  })
})

describe('flutterMachineMode', () => {
  it('only flutter run … --machine (direct or behind fvm), mode from flags', () => {
    expect(flutterMachineMode(['flutter', 'run', '--machine', '-d', 'x'])).toBe('debug')
    expect(flutterMachineMode(['fvm', 'flutter', 'run', '--machine', '--release'])).toBe('release')
    expect(flutterMachineMode(['C:\\sdk\\bin\\flutter.bat', 'run', '--profile', '--machine'])).toBe('profile')
    expect(flutterMachineMode(['flutter', 'run', '-d', 'x'])).toBeNull()
    expect(flutterMachineMode(['flutter', 'test', '--machine'])).toBeNull()
    expect(flutterMachineMode(['melos', 'run', 'flutter', 'run', '--machine'])).toBeNull()
  })
})

describe('templates', () => {
  const p: FlutterProject = { kind: 'flutter', dir: path.join(tmp, 'app'), name: 'app', type: 'app', entrypoints: ['lib/main.dart'], platforms: ['android'], flavors: ['dev'], needsPubGet: false, fvm: null }
  it('cleanTemplates falls back per field', () => {
    expect(cleanTemplates({ flutter: { mode: 'nope', flavor: 'a b', args: '--x' }, android: { variant: 'release' } })).toEqual({
      flutter: { mode: 'debug', flavor: '', args: '--x' },
      android: { variant: 'release', args: '' },
    })
  })
  it('auto-created configs use mode / args and a declared flavor', () => {
    const t = cleanTemplates({ flutter: { mode: 'profile', flavor: 'dev', args: '--dart-define=A=1' } })
    const [main] = defaultConfigs([p], tmp, t)
    expect(main).toMatchObject({ type: 'flutter', mode: 'profile', flavor: 'dev', args: '--dart-define=A=1' })
    const [other] = defaultConfigs([{ ...p, flavors: [] }], tmp, t)
    expect(other).toMatchObject({ flavor: '' })
  })
})

describe('per-project Flutter SDK', () => {
  const deps: EnvDeps = {
    isFile: (f) => f.replace(/\\/g, '/').endsWith('/bin/flutter') && !f.includes('missing'),
    isDir: () => false,
    readText: () => null,
    readdir: () => [],
    realpath: (f) => f,
    exec: async () => ({ ok: false, stdout: '', stderr: '' }),
  }
  it('project setting wins over the global one; invalid one is reported and skipped', () => {
    const settings = { flutterSdk: '/global', flutterSdkProjects: { [projectSdkKey('/proj', 'linux')]: '/pinned' } }
    const opts = { ...sdkSettings(settings, '/proj', 'linux'), env: {}, platform: 'linux' as const, home: '/h' }
    expect(findFlutterSdk('/proj', opts, deps)).toMatchObject({ sdk: '/pinned', source: 'project' })
    const other = { ...sdkSettings(settings, '/other', 'linux'), env: {}, platform: 'linux' as const, home: '/h' }
    expect(findFlutterSdk('/other', other, deps)).toMatchObject({ sdk: '/global', source: 'setting' })
    const bad = { ...sdkSettings({ flutterSdk: '/global', flutterSdkProjects: { '/proj': '/missing' } }, '/proj', 'linux'), env: {}, platform: 'linux' as const, home: '/h' }
    expect(findFlutterSdk('/proj', bad, deps)).toMatchObject({ sdk: '/global', issues: [{ code: 'flutter-project-invalid', detail: '/missing' }] })
  })
})

describe('toolchain', () => {
  it('parses doctor --machine and doctor -v', () => {
    const machine = parseDoctorMachine(
      JSON.stringify([
        { name: 'Flutter', type: 'installed', statusInfo: 'Channel stable, 3.35.0', messages: [{ message: 'Flutter at /sdk', type: 'information' }] },
        { name: 'Android toolchain', type: 'partial', statusInfo: '', messages: [{ message: 'Some licences not accepted', type: 'hint' }] },
      ]),
    )
    expect(machine).toEqual([
      { name: 'Flutter', status: 'ok', summary: 'Channel stable, 3.35.0', messages: [{ status: 'ok', text: 'Flutter at /sdk' }] },
      { name: 'Android toolchain', status: 'warning', summary: '', messages: [{ status: 'warning', text: 'Some licences not accepted' }] },
    ])
    expect(parseDoctorMachine('Could not find an option named "machine".')).toBeNull()
    const text = parseDoctorText('[√] Flutter (Channel stable, 3.35.0, on Windows)\n    • Flutter version 3.35.0\n[X] Chrome - develop for the web\n    X Cannot find Chrome executable\n[!] Android Studio (not installed)\n')
    expect(text.map((c) => [c.name, c.status, c.summary])).toEqual([
      ['Flutter', 'ok', 'Channel stable, 3.35.0, on Windows'],
      ['Chrome', 'error', 'develop for the web'],
      ['Android Studio', 'warning', 'not installed'],
    ])
    expect(text[1]!.messages).toEqual([{ status: 'error', text: 'Cannot find Chrome executable' }])
  })

  it('flutter: falls back to -v, masks output, reports a missing SDK', async () => {
    const calls: string[][] = []
    const exec: ToolchainExec = async (spec) => {
      calls.push(spec.args)
      return spec.args.includes('--machine') ? { stdout: 'unknown flag', stderr: '', timedOut: false } : { stdout: '[✓] Flutter (at /home/u/sdk)\n', stderr: '', timedOut: false }
    }
    const r = await flutterToolchain({ sdk: '/sdk', platform: 'linux', env: {}, exec, mask: createLogMasker('/home/u', 'linux') })
    expect(calls).toEqual([['doctor', '--machine'], ['doctor', '-v']])
    expect(r.checks[0]).toMatchObject({ name: 'Flutter', status: 'ok', summary: 'at ~/sdk' })
    expect((await flutterToolchain({ sdk: null, platform: 'linux', env: {}, exec, mask: (t) => t })).error).toEqual({ code: 'flutter-missing' })
  })

  it('android: jdk / sdk / adb / emulator / gradlew checks', async () => {
    const env: AndroidEnv = { kind: 'android', sdk: '/sdk', adb: '/sdk/platform-tools/adb', emulator: null, jdk: '/jdk', jdkVersion: 17, gradlew: false, issues: [{ code: 'gradlew-missing' }] }
    const exec: ToolchainExec = async (spec) => (spec.args[0] === '-version' ? { stdout: '', stderr: 'openjdk version "17.0.9"\n', timedOut: false } : { stdout: 'Android Debug Bridge version 1.0.41\n', stderr: '', timedOut: false })
    const r = await androidToolchain({ env, platform: 'linux', exec, mask: (t) => t })
    expect(r.checks.map((c) => [c.name, c.status])).toEqual([
      ['jdk', 'ok'],
      ['sdk', 'ok'],
      ['adb', 'ok'],
      ['emulator', 'warning'],
      ['gradlew', 'error'],
    ])
    expect(r.checks[0]!.summary).toBe('openjdk version "17.0.9"')
  })
})

describe('ProjectWatchers', () => {
  it('debounces relevant file changes per root and closes folders no longer wanted', async () => {
    const handlers = new Map<string, (file: string | null) => void>()
    const closed: string[] = []
    const changes: string[] = []
    const w = new ProjectWatchers({
      onChange: (root) => changes.push(root),
      debounceMs: 20,
      watch: (dir, cb) => {
        handlers.set(dir, cb)
        return { close: () => void closed.push(dir) }
      },
    })
    w.sync('/r', ['/r', '/r/lib'])
    handlers.get('/r')!('README.md')
    handlers.get('/r')!('pubspec.yaml')
    handlers.get('/r/lib')!('main_dev.dart')
    await tick(40)
    expect(changes).toEqual(['/r'])
    w.sync('/r', ['/r'])
    expect(closed).toEqual(['/r/lib'])
    w.close('/r')
    expect(closed).toEqual(['/r/lib', '/r'])
    expect(DETECT_FILE.test('settings.gradle.kts') && DETECT_FILE.test('AndroidManifest.xml') && !DETECT_FILE.test('Main.kt')).toBe(true)
  })

  it('watchDirs covers flutter + android project folders', () => {
    const dirs = watchDirs({
      root: '/r',
      at: 0,
      projects: [
        { kind: 'flutter', dir: '/r/app', name: 'app', type: 'app', entrypoints: [], platforms: [], flavors: [], needsPubGet: false, fvm: null },
        { kind: 'android', dir: '/r/native', name: 'n', framework: 'native', status: 'runnable', modules: [{ path: ':app', dir: '/r/native/app', type: 'application', manifest: '/r/native/app/src/main/AndroidManifest.xml', launcher: true, guessed: false }] },
      ],
    }).map((d) => d.replace(/\\/g, '/'))
    expect(dirs).toEqual(expect.arrayContaining(['/r', '/r/app', '/r/app/lib', '/r/app/.dart_tool', '/r/app/android/app', '/r/native', '/r/native/gradle', '/r/native/app', '/r/native/app/src/main']))
  })
})

const phone: RunDevice = { id: 'R58', name: 'Galaxy', platform: 'android-arm64', emulator: false, state: 'ready', source: 'flutter' }

function flutterProject(): string {
  const root = path.join(tmp, `p${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  mkdirSync(path.join(root, 'android'), { recursive: true })
  mkdirSync(path.join(root, '.dart_tool'), { recursive: true })
  writeFileSync(path.join(root, 'pubspec.yaml'), 'name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n')
  writeFileSync(path.join(root, '.metadata'), 'project_type: app\n')
  writeFileSync(path.join(root, 'lib', 'main.dart'), 'void main() {}\n')
  writeFileSync(path.join(root, '.dart_tool', 'package_config.json'), '{}')
  writeFileSync(path.join(root, 'pubspec.lock'), '')
  const later = new Date(Date.now() + 5000)
  utimesSync(path.join(root, 'pubspec.lock'), later, later)
  return root
}

function setup(runner?: (ctx: RunContext) => Runner) {
  const events: RunEvent[] = []
  const stopped: string[] = []
  const service = (name: string): DeviceService => ({
    list: async () => [phone],
    onChange: () => () => undefined,
    emulators: async () => [],
    launchEmulator: async () => ({ ok: true }),
    stop: () => void stopped.push(name),
  })
  const simple = (ctx: RunContext): Runner => ({ start: async () => ctx.hooks.state('running'), stop: async () => ctx.hooks.state('stopped'), kill: () => undefined })
  const m = new RunManager({
    dataDir: path.join(tmp, `data-${Math.random().toString(36).slice(2, 8)}`),
    env: {},
    platform: process.platform,
    home: tmp,
    spawn: () => {
      throw new Error('no spawn')
    },
    runners: { flutter: runner ?? simple, android: simple, custom: simple },
    devices: { flutter: () => service('flutter'), adb: () => service('adb') },
    broadcast: (e) => events.push(e),
    confirm: async () => true,
    watchDebounceMs: 30,
  })
  return { m, events, stopped }
}

describe('RunManager v31 gaps', () => {
  it('device trackers stop when the last hold goes and nothing runs; a live run keeps them until it ends', async () => {
    const { m, stopped } = setup()
    const root = flutterProject()
    await m.hold(root, 'w1:a', true)
    await m.devices()
    await m.hold(root, 'w1:a', false)
    expect(stopped.sort()).toEqual(['adb', 'flutter'])

    stopped.length = 0
    await m.hold(root, 'w1:a', true)
    await m.devices()
    const [cfg] = await m.configs(root)
    await m.start({ root, configId: cfg!.id, deviceId: 'R58' })
    await tick()
    m.releaseOwner('w1')
    expect(stopped).toEqual([])
    await m.stop(m.live()[0]!.id)
    expect(stopped.sort()).toEqual(['adb', 'flutter'])
  })

  it('a held root re-detects on pubspec changes and pushes projects + configs', async () => {
    const { m, events } = setup()
    const root = flutterProject()
    await m.hold(root, 'w1:a', true)
    writeFileSync(path.join(root, 'lib', 'main_dev.dart'), 'void main() {}\n')
    const end = Date.now() + 3000
    while (Date.now() < end && !events.some((e) => e.type === 'configs')) await tick(50)
    expect(events.some((e) => e.type === 'projects' && (e.result.projects[0] as FlutterProject).entrypoints.includes('lib/main_dev.dart'))).toBe(true)
    expect(events.some((e) => e.type === 'configs' && e.configs.length === 2)).toBe(true)
    await m.hold(root, 'w1:a', false)
    expect(m.held(root)).toBe(false)
  })

  it('masks run output, progress and error messages', async () => {
    const home = tmp
    const { m, events } = setup((ctx) => ({
      start: async () => {
        ctx.hooks.state('building', { progress: `Compiling ${home}/x` })
        ctx.hooks.log({ stream: 'build', text: `${home}${path.sep}lib${path.sep}main.dart ghp_abcdefghijklmnopqrstuvwxyz123456` })
        ctx.hooks.error({ file: path.join(home, 'lib', 'main.dart'), line: 1, col: 1, message: `bad in ${home}`, severity: 'error' })
      },
      stop: async () => undefined,
      kill: () => undefined,
    }))
    const root = flutterProject()
    const [cfg] = await m.configs(root)
    await m.devices()
    await m.start({ root, configId: cfg!.id, deviceId: 'R58' })
    await tick(150)
    const log = events.flatMap((e) => (e.type === 'log' ? e.lines.map((l) => l.text) : []))
    expect(log[0]).toMatch(/^~[\\/]lib[\\/]main\.dart \[masked\]$/)
    const err = events.find((e) => e.type === 'error')
    expect(err?.type === 'error' && err.error.message).toBe('bad in ~')
    expect(err?.type === 'error' && err.error.file).toBe(path.join(home, 'lib', 'main.dart'))
    expect(events.some((e) => e.type === 'session' && e.session.progress === 'Compiling ~/x')).toBe(true)
  })

  it('auto-import runs once per project', async () => {
    const { m } = setup()
    const root = flutterProject()
    mkdirSync(path.join(root, '.vscode'), { recursive: true })
    writeFileSync(path.join(root, '.vscode', 'launch.json'), JSON.stringify({ configurations: [{ name: 'dev', type: 'dart', request: 'launch', program: 'lib/main.dart' }] }))
    expect((await m.autoImport(root)).map((c) => c.name)).toEqual(['dev'])
    await m.deleteConfig(root, (await m.configs(root)).find((c) => c.name === 'dev')!.id)
    expect(await m.autoImport(root)).toEqual([])
  })

  it('templates shape the auto configs and persist; project SDK persists per dir', async () => {
    const { m } = setup()
    const root = flutterProject()
    await m.setTemplates({ flutter: { mode: 'profile', flavor: '', args: '--x' }, android: { variant: 'debug', args: '' } })
    expect((await m.configs(root))[0]).toMatchObject({ mode: 'profile', args: '--x' })
    const s = await m.setProjectFlutterSdk(root, path.join(tmp, 'sdk'))
    expect(s.flutterSdkProjects).toEqual({ [projectSdkKey(root, process.platform)]: path.join(tmp, 'sdk') })
    expect((await m.setProjectFlutterSdk(root, null)).flutterSdkProjects).toEqual({})
  })
})
