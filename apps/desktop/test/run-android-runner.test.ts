import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AndroidRunConfig, EnvIssue, RunDevice, RunLogLine, RunState, BuildError } from '@ccm/shared'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdbDevices } from '../src/run/android/devices'
import type { EnvDeps } from '../src/run/android/env'
import { androidRunnerFactory, apkDirs, findApk } from '../src/run/android/runner'
import { killTree, killTreeSparing, type SpawnSpec, type Spawner } from '../src/run/proc'
import type { RunContext } from '../src/run/types'

vi.mock('../src/run/proc', async (orig) => {
  const mod = await orig<typeof import('../src/run/proc')>()
  const fakeKill = (child: FakeChild): void => {
    if (child.exitCode !== null) return
    child.exitCode = -1
    process.nextTick(() => child.emit('close', null))
  }
  return {
    ...mod,
    killTree: vi.fn((child: FakeChild) => fakeKill(child)),
    killTreeSparing: vi.fn((child: FakeChild) => fakeKill(child)),
  }
})

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-android-run-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
let n = 0

interface FakeChild extends EventEmitter {
  key: string
  spec: SpawnSpec
  exitCode: number | null
  pid: undefined
  stdout: EventEmitter & { resume: () => void }
  stderr: EventEmitter & { resume: () => void }
  unref: () => void
  kill: (signal?: string) => boolean
  out: (text: string) => void
  exit: (code: number) => void
}

type Reply = { out?: string; code?: number } | 'live'
type Route = [RegExp, Reply | ((key: string) => Reply)]

function stream(): EventEmitter & { resume: () => void } {
  return Object.assign(new EventEmitter(), { resume: () => undefined })
}

function fakeSpawn(routes: Route[]): { spawn: Spawner; calls: FakeChild[]; keys: () => string[] } {
  const calls: FakeChild[] = []
  const spawn: Spawner = (spec) => {
    const key = [spec.file.replace(/\\/g, '/').split('/').pop(), ...spec.args].join(' ')
    const child = Object.assign(new EventEmitter(), {
      key,
      spec,
      exitCode: null as number | null,
      pid: undefined,
      stdout: stream(),
      stderr: stream(),
      unref: () => undefined,
      kill: vi.fn(() => {
        if (child.exitCode !== null) return false
        child.exitCode = -1
        process.nextTick(() => child.emit('close', null))
        return true
      }),
      out(text: string) {
        child.stdout.emit('data', Buffer.from(text))
      },
      exit(code: number) {
        child.exitCode = code
        child.emit('close', code)
      },
    }) as FakeChild
    calls.push(child)
    const route = routes.find(([re]) => re.test(key))
    const reply = route ? (typeof route[1] === 'function' ? route[1](key) : route[1]) : { code: 0 }
    if (reply !== 'live') {
      process.nextTick(() => {
        if (reply.out) child.out(reply.out)
        child.exit(reply.code ?? 0)
      })
    }
    return child as unknown as ChildProcess
  }
  return { spawn, calls, keys: () => calls.map((c) => c.key) }
}

const envDeps = (javaVersion = '17.0.9'): EnvDeps => ({
  isFile: async () => true,
  readText: async () => null,
  mode: async () => 0o755,
  exec: async () => ({ stdout: '', stderr: `openjdk version "${javaVersion}"` }),
})

function project(withApk = true): string {
  const dir = path.join(tmp, `p${n++}`)
  const out = path.join(dir, 'app', 'build', 'outputs', 'apk', 'free', 'debug')
  mkdirSync(out, { recursive: true })
  if (withApk) {
    writeFileSync(
      path.join(out, 'output-metadata.json'),
      JSON.stringify({ applicationId: 'com.ex', variantName: 'freeDebug', elements: [{ outputFile: 'app-free-debug.apk' }] }),
    )
  }
  return dir
}

const DEVICE: RunDevice = { id: 'emulator-5554', name: 'Pixel 7', platform: 'android', emulator: true, state: 'ready', source: 'adb' }

function setup(routes: Route[], opts: { withApk?: boolean; java?: string; confirm?: boolean; beforeLaunch?: string[]; timing?: Record<string, number> } = {}) {
  const cwd = project(opts.withApk ?? true)
  const fake = fakeSpawn(routes)
  const states: { state: RunState; patch?: unknown }[] = []
  const fails: EnvIssue[] = []
  const logs: Omit<RunLogLine, 'at'>[] = []
  const errors: BuildError[] = []
  const confirm = vi.fn(async () => opts.confirm ?? true)
  const config: AndroidRunConfig = {
    id: 'c1',
    name: 'app',
    type: 'android',
    cwd,
    shared: false,
    env: { FOO: 'bar' },
    beforeLaunch: opts.beforeLaunch ?? [],
    module: ':app',
    variant: 'freeDebug',
    device: 'selected',
    args: '',
  }
  const ctx: RunContext = {
    root: cwd,
    config,
    device: DEVICE,
    settings: { flutterSdk: null, androidSdk: '/sdk', jdk: '/jdk' },
    env: { PATH: '' },
    platform: 'linux',
    home: tmp,
    spawn: fake.spawn,
    hooks: {
      state: (state, patch) => states.push(patch ? { state, patch } : { state }),
      fail: (f) => fails.push(f),
      log: (l) => logs.push(l),
      error: (e) => errors.push(e),
      confirm,
    },
  }
  const runner = androidRunnerFactory({ envDeps: envDeps(opts.java), timing: { pidSearchMs: 5, pidWatchMs: 5, goneMs: 40, adbMs: 1_000, forceStopMs: 1_000, ...opts.timing } })(ctx)
  return { runner, fake, states, fails, logs, errors, confirm, cwd, names: () => states.map((s) => s.state) }
}

const GRADLE_OK: Route = [/^gradlew /, { out: '> Task :app:assembleFreeDebug\nBUILD SUCCESSFUL in 3s\n' }]
const INSTALL_OK: Route = [/ install -r -t /, { out: 'Performing Streamed Install\nSuccess\n' }]
const RESOLVE: Route = [/resolve-activity/, { out: 'priority=0 preferredOrder=0\ncom.ex/.MainActivity\n' }]
const AM_START: Route = [/ am start -n /, { out: 'Starting: Intent { cmp=com.ex/.MainActivity }\n' }]

function pidSequence(...pids: string[]): Route {
  let i = 0
  return [/ pidof -s com\.ex$/,() => ({ out: pids[Math.min(i++, pids.length - 1)] ?? '', code: pids[Math.min(i - 1, pids.length - 1)] ? 0 : 1 })]
}

const killed = (child: unknown, sync?: boolean): boolean =>
  vi.mocked(killTree).mock.calls.some(([c, s]) => c === child && (sync === undefined || s === sync)) ||
  vi.mocked(killTreeSparing).mock.calls.some(([c, , o]) => c === child && (sync === undefined || (o?.sync ?? false) === sync))

beforeEach(() => {
  vi.mocked(killTree).mockClear()
  vi.mocked(killTreeSparing).mockClear()
})

describe('android runner', () => {
  it('builds, installs, launches and follows logcat across pid changes', async () => {
    const t = setup([GRADLE_OK, INSTALL_OK, RESOLVE, AM_START, pidSequence('', '1234', '1234', '5678'), [/ logcat /, 'live']])
    await t.runner.start()
    expect(t.names()).toEqual(['building', 'installing', 'launching', 'running'])
    expect(t.states.at(-1)?.patch).toEqual({ appId: 'com.ex' })
    expect(t.fails).toEqual([])

    const gradle = t.fake.calls.find((c) => c.key.startsWith('gradlew'))!
    expect(gradle.key).toBe('gradlew :app:assembleFreeDebug --console=plain')
    expect(gradle.spec.env).toEqual({ JAVA_HOME: '/jdk', ANDROID_HOME: '/sdk', FOO: 'bar' })
    const apk = path.join(t.cwd, 'app', 'build', 'outputs', 'apk', 'free', 'debug', 'app-free-debug.apk')
    expect(t.fake.keys()).toContain(`adb -s emulator-5554 install -r -t ${apk}`)
    expect(t.fake.keys()).toContain('adb -s emulator-5554 shell am start -n com.ex/.MainActivity')

    await vi.waitFor(() => expect(t.fake.keys().some((k) => k.includes(' logcat '))).toBe(true))
    const first = t.fake.calls.find((c) => c.key.includes(' logcat '))!
    expect(first.key).toBe('adb -s emulator-5554 logcat -v threadtime --pid=1234')
    first.out('10-15 12:34:56.789  1234  1250 W MyTag   : hello there\n--------- beginning of main\n')
    expect(t.logs).toContainEqual({ stream: 'logcat', level: 'W', tag: 'MyTag', text: 'hello there' })
    expect(t.logs.some((l) => l.text.includes('beginning of'))).toBe(false)

    await vi.waitFor(() => expect(t.fake.keys().filter((k) => k.includes(' logcat '))).toHaveLength(2))
    expect(t.fake.calls.filter((c) => c.key.includes(' logcat '))[1]!.key).toBe('adb -s emulator-5554 logcat -v threadtime --pid=5678')
    expect(killed(first)).toBe(true)

    await t.runner.stop()
    await t.runner.stop()
    expect(t.fake.keys()).toContain('adb -s emulator-5554 shell am force-stop com.ex')
    expect(t.names().slice(-2)).toEqual(['stopping', 'stopped'])
  })

  it('reports Kotlin errors and fails the build on a non-zero exit', async () => {
    const t = setup([[/^gradlew /, { out: 'e: file:///C:/src/app/Main.kt:12:5 Unresolved reference: foo\nBUILD FAILED\n', code: 1 }]])
    await t.runner.start()
    expect(t.errors).toHaveLength(1)
    expect(t.errors[0]).toMatchObject({ line: 12, col: 5, message: 'Unresolved reference: foo', severity: 'error' })
    expect(t.fails).toEqual([{ code: 'build' }])
    expect(t.fake.keys().some((k) => k.includes('install'))).toBe(false)
  })

  it('fails with the blocking env issue before spawning anything', async () => {
    const t = setup([], { java: '11.0.2' })
    await t.runner.start()
    expect(t.fails).toEqual([{ code: 'jdk-old', detail: '11' }])
    expect(t.fake.calls).toHaveLength(0)
  })

  it('fails when the build left no output-metadata.json', async () => {
    const t = setup([GRADLE_OK], { withApk: false })
    await t.runner.start()
    expect(t.fails).toEqual([{ code: 'install', detail: 'apk-missing' }])
  })

  it('uninstalls and reinstalls on a signature mismatch when confirmed', async () => {
    let installs = 0
    const t = setup([
      GRADLE_OK,
      [/ install -r -t /, () => (installs++ ? { out: 'Success\n' } : { out: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]\n', code: 1 })],
      RESOLVE,
      AM_START,
      pidSequence(''),
    ])
    await t.runner.start()
    expect(t.confirm).toHaveBeenCalledWith('reinstall', 'com.ex')
    expect(t.fake.keys()).toContain('adb -s emulator-5554 uninstall com.ex')
    expect(t.names().at(-1)).toBe('running')
    t.runner.kill()
  })

  it('fails on a signature mismatch when the reinstall is declined', async () => {
    const t = setup([GRADLE_OK, [/ install -r -t /, { out: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]\n', code: 1 }]], { confirm: false })
    await t.runner.start()
    expect(t.fails).toEqual([{ code: 'install', detail: 'signature' }])
    expect(t.fake.keys().some((k) => k.includes('uninstall'))).toBe(false)
  })

  it('maps other install failures', async () => {
    const t = setup([GRADLE_OK, [/ install -r -t /, { out: 'Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]\n', code: 1 }]])
    await t.runner.start()
    expect(t.fails).toEqual([{ code: 'install', detail: 'storage' }])
  })

  it('falls back to monkey and reports a missing launcher', async () => {
    const t = setup([
      GRADLE_OK,
      INSTALL_OK,
      [/resolve-activity/, { out: 'No activity found\n' }],
      [/ monkey /, { out: '** No activities found to run, monkey aborted.\n', code: 252 }],
    ])
    await t.runner.start()
    expect(t.fake.keys()).toContain('adb -s emulator-5554 shell monkey -p com.ex -c android.intent.category.LAUNCHER 1')
    expect(t.fails).toEqual([{ code: 'launch', detail: 'no-launcher' }])
  })

  it('kills the gradle tree when stopped during the build', async () => {
    const t = setup([[/^gradlew /, 'live']])
    const started = t.runner.start()
    await vi.waitFor(() => expect(t.fake.calls).toHaveLength(1))
    await t.runner.stop()
    await started
    expect(killed(t.fake.calls[0])).toBe(true)
    expect(vi.mocked(killTreeSparing).mock.calls.some(([c, re]) => c === t.fake.calls[0] && re.test('org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.7'))).toBe(true)
    expect(t.names()).toEqual(['building', 'stopping', 'cancelled'])
    expect(t.fails).toEqual([])
    expect(t.fake.keys().some((k) => k.includes('force-stop'))).toBe(false)
  })

  it('ends the session when the app process is gone', async () => {
    const t = setup([GRADLE_OK, INSTALL_OK, RESOLVE, AM_START, pidSequence('1234', ''), [/ logcat /, 'live']])
    await t.runner.start()
    await vi.waitFor(() => expect(t.names().at(-1)).toBe('stopped'))
    expect(killed(t.fake.calls.find((c) => c.key.includes(' logcat ')))).toBe(true)
  })

  it('kill() tree-kills every child synchronously', async () => {
    const t = setup([GRADLE_OK, INSTALL_OK, RESOLVE, AM_START, pidSequence('1234'), [/ logcat /, 'live']])
    await t.runner.start()
    await vi.waitFor(() => expect(t.fake.keys().some((k) => k.includes(' logcat '))).toBe(true))
    t.runner.kill()
    expect(killed(t.fake.calls.find((c) => c.key.includes(' logcat ')), true)).toBe(true)
    expect(t.fake.keys()).toContain('adb -s emulator-5554 shell am force-stop com.ex')
  })

  it('falls back to ps when pidof is missing on the device', async () => {
    const t = setup([
      GRADLE_OK,
      INSTALL_OK,
      RESOLVE,
      AM_START,
      [/ pidof -s /, { out: '/system/bin/sh: pidof: not found\n', code: 127 }],
      [/ ps -A -o PID,NAME$/, { out: '  PID NAME\n  901 com.ex:remote\n  877 com.ex\n  612 system_server\n' }],
      [/ logcat /, 'live'],
    ])
    await t.runner.start()
    await vi.waitFor(() => expect(t.fake.keys()).toContain('adb -s emulator-5554 logcat -v threadtime --pid=877'))
    t.runner.kill()
  })

  it('logs once when no app process shows up', async () => {
    const t = setup([GRADLE_OK, INSTALL_OK, RESOLVE, AM_START, pidSequence('')], { timing: { noPidNoticeMs: 20 } })
    await t.runner.start()
    await vi.waitFor(() => expect(t.logs.filter((l) => l.text.includes('logcat is not attached'))).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 60))
    expect(t.logs.filter((l) => l.text.includes('logcat is not attached'))).toHaveLength(1)
    expect(t.names().at(-1)).toBe('running')
    t.runner.kill()
  })

  it('ignores output-metadata for another variant or pointing outside build/', async () => {
    const dir = path.join(tmp, `apk${n++}`)
    const out = path.join(dir, 'build', 'outputs', 'apk', 'debug')
    mkdirSync(out, { recursive: true })
    const meta = (variantName: string, outputFile: string): void =>
      writeFileSync(path.join(out, 'output-metadata.json'), JSON.stringify({ applicationId: 'com.ex', variantName, elements: [{ outputFile }] }))
    meta('release', 'app.apk')
    expect(await findApk(dir, 'debug')).toBeNull()
    meta('debug', '../../../../../evil.apk')
    expect(await findApk(dir, 'debug')).toBeNull()
    meta('debug', 'app-debug.apk')
    expect(await findApk(dir, 'debug')).toEqual({ apk: path.join(out, 'app-debug.apk'), applicationId: 'com.ex' })
  })

  it('maps variants to AGP output dirs', () => {
    expect(apkDirs('debug')).toEqual(['debug'])
    expect(apkDirs('freeArmDebug')).toEqual(['freeArm/debug', 'debug', 'freeArmDebug'])
  })
})

const frame = (body: string): string => body.length.toString(16).padStart(4, '0') + body

describe('adb device service', () => {
  const deps: EnvDeps = { ...envDeps(), isFile: async (f) => f.startsWith('/sdk/') }
  const base = { settings: { flutterSdk: null, androidSdk: '/sdk', jdk: null }, env: {}, platform: 'linux' as const, home: tmp, deps }

  it('streams track-devices frames to listeners', async () => {
    const fake = fakeSpawn([[/track-devices/, 'live']])
    const svc = createAdbDevices({ ...base, spawn: fake.spawn })
    const seen: RunDevice[][] = []
    svc.onChange((d) => seen.push(d))
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    expect(fake.calls[0]!.key).toBe('adb track-devices -l')
    fake.calls[0]!.out(frame('emulator-5554\tdevice product:sdk model:Pixel_7 device:emu transport_id:1\n') + frame('').slice(0, 2))
    expect(seen).toHaveLength(1)
    expect(seen[0]![0]).toMatchObject({ id: 'emulator-5554', name: 'Pixel 7', emulator: true, state: 'ready' })
    expect(await svc.list()).toHaveLength(1)
    fake.calls[0]!.out('00' + frame('R58M\tunauthorized transport_id:2\n'))
    expect(seen[1]!.map((d) => d.state)).toEqual(['unauthorized'])
    svc.stop()
    // PID only: the first adb client is the parent of `adb fork-server`, a tree kill would take the server down.
    expect(fake.calls[0]!.kill).toHaveBeenCalledWith('SIGKILL')
    expect(killed(fake.calls[0])).toBe(false)
  })

  it('restarts the tracker, then falls back to polling', async () => {
    const fake = fakeSpawn([
      [/track-devices/, { code: 1 }],
      [/devices -l$/, { out: 'List of devices attached\nR58M  device usb:1 model:SM_G991B\n' }],
    ])
    const svc = createAdbDevices({ ...base, spawn: fake.spawn, timing: { pollMs: 5 } })
    const seen: RunDevice[][] = []
    svc.onChange((d) => seen.push(d))
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(fake.keys().filter((k) => k.includes('track-devices'))).toHaveLength(4)
    expect(seen[0]![0]).toMatchObject({ id: 'R58M', name: 'SM G991B' })
    svc.stop()
  })

  it('lists AVDs, skipping emulator log lines', async () => {
    const fake = fakeSpawn([[/-list-avds/, { out: 'INFO    | Storing crashdata in: /tmp/x\nPixel_7_API_34\nTablet\n' }]])
    const svc = createAdbDevices({ ...base, spawn: fake.spawn })
    expect(await svc.emulators()).toEqual([
      { id: 'Pixel_7_API_34', name: 'Pixel 7 API 34', source: 'adb' },
      { id: 'Tablet', name: 'Tablet', source: 'adb' },
    ])
  })

  it('launches an AVD and waits for boot', async () => {
    let polls = 0
    let boots = 0
    const fake = fakeSpawn([
      [/^emulator -avd/, 'live'],
      [/^adb devices -l$/, () => (polls++ < 2 ? { out: 'List of devices attached\n' } : { out: 'emulator-5556\tdevice\n' })],
      [/emu avd name/, { out: 'Pixel_7_API_34\nOK\n' }],
      [/getprop sys.boot_completed/, () => ({ out: boots++ > 1 ? '1\n' : '\n' })],
    ])
    const svc = createAdbDevices({ ...base, spawn: fake.spawn, timing: { bootPollMs: 5 } })
    expect(await svc.launchEmulator('Pixel_7_API_34')).toEqual({ ok: true })
    expect(fake.keys()).toContain('emulator -avd Pixel_7_API_34')
    expect(killed(fake.calls.find((c) => c.key.startsWith('emulator')))).toBe(false)
  })
})
