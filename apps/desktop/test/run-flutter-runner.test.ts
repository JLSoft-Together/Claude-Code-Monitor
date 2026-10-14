import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { BuildError, EnvIssue, FlutterRunConfig, RunLogLine, RunState } from '@ccm/shared'
import { createFlutterDevices } from '../src/run/flutter/devices'
import { createFlutterRunner } from '../src/run/flutter/runner'
import type { SpawnSpec } from '../src/run/proc'
import type { RunContext, RunnerFactory, RunnerHooks } from '../src/run/types'

const typed: RunnerFactory = createFlutterRunner
void typed

interface FakeChild extends ChildProcess {
  sent: Record<string, unknown>[]
  msg(obj: Record<string, unknown>): void
  out(line: string): void
  err(line: string): void
  exit(code: number | null): Promise<void>
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

function fakeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild
  const stdin = new PassThrough()
  Object.assign(c, { stdout: new PassThrough(), stderr: new PassThrough(), stdin, pid: undefined, exitCode: null, sent: [] })
  stdin.on('data', (chunk: Buffer) => {
    for (const l of chunk.toString().split('\n').filter(Boolean)) c.sent.push((JSON.parse(l) as Record<string, unknown>[])[0]!)
  })
  c.msg = (obj) => (c.stdout as PassThrough).write(JSON.stringify([obj]) + '\n')
  c.out = (line) => (c.stdout as PassThrough).write(line + '\n')
  c.err = (line) => (c.stderr as PassThrough).write(line + '\n')
  c.exit = async (code) => {
    await tick()
    c.emit('close', code)
    await tick()
  }
  return c
}

function harness(cfg: Partial<FlutterRunConfig> = {}, opts: { sdk?: string | null; children?: FakeChild[] } = {}) {
  const states: { state: RunState; patch?: Record<string, unknown> }[] = []
  const logs: Omit<RunLogLine, 'at'>[] = []
  const errors: BuildError[] = []
  const fails: EnvIssue[] = []
  const specs: SpawnSpec[] = []
  const children = opts.children ?? [fakeChild()]
  const hooks: RunnerHooks = {
    state: (state, patch) => states.push(patch ? { state, patch } : { state }),
    fail: (f) => fails.push(f),
    log: (l) => logs.push(l),
    error: (e) => errors.push(e),
    confirm: async () => true,
  }
  const config: FlutterRunConfig = {
    id: 'c1',
    name: 'main',
    type: 'flutter',
    cwd: '/proj',
    shared: false,
    env: {},
    beforeLaunch: [],
    entrypoint: 'lib/main.dart',
    device: 'selected',
    mode: 'debug',
    flavor: '',
    args: '',
    attachArgs: '',
    ...cfg,
  }
  let i = 0
  const ctx: RunContext = {
    root: '/proj',
    config,
    device: { id: 'emulator-5554', name: 'Pixel', platform: 'android-x64', emulator: true, state: 'ready', source: 'flutter' },
    settings: { flutterSdk: null, androidSdk: null, jdk: null },
    env: { PATH: '' },
    platform: 'linux',
    home: '/home/u',
    spawn: (spec) => {
      specs.push(spec)
      const c = children[i++]
      if (!c) throw new Error('no more children')
      return c
    },
    hooks,
  }
  const kill = vi.fn()
  const sdk = opts.sdk === undefined ? '/sdk' : opts.sdk
  const runner = createFlutterRunner(ctx, {
    findSdk: () => ({ sdk, source: sdk ? 'setting' : null, fvm: null, issues: sdk ? [] : [{ code: 'flutter-missing' }] }),
    kill,
    stopTimeoutMs: 20,
  })
  return { runner, states, logs, errors, fails, specs, children, kill, child: children[0]! }
}

const stateList = (s: { state: RunState }[]): RunState[] => s.map((x) => x.state).filter((x, i, a) => x !== a[i - 1])

async function boot(h: ReturnType<typeof harness>): Promise<Promise<void>> {
  const started = h.runner.start()
  await tick()
  h.child.msg({ event: 'daemon.connected', params: { version: '0.6.1', pid: 42 } })
  h.child.msg({ event: 'app.start', params: { appId: 'app-1', deviceId: 'emulator-5554', mode: 'debug' } })
  h.child.msg({ event: 'app.progress', params: { appId: 'app-1', id: 'p1', message: "Running Gradle task 'assembleDebug'..." } })
  h.child.out('lib/main.dart:3:5: Warning: unused import')
  h.child.msg({ event: 'app.progress', params: { appId: 'app-1', id: 'p1', finished: true } })
  h.child.msg({ event: 'app.debugPort', params: { appId: 'app-1', port: 1, wsUri: 'ws://127.0.0.1:1/abc=/ws' } })
  h.child.msg({ event: 'app.devTools', params: { uri: 'http://127.0.0.1:9100' } })
  h.child.msg({ event: 'app.started', params: { appId: 'app-1' } })
  return started
}

describe('flutter runner', () => {
  it('start → progress → debugPort → started; logs and build errors', async () => {
    const h = harness()
    await boot(h)
    expect(h.specs[0]).toMatchObject({ file: '/sdk/bin/flutter', cwd: '/proj', verbatim: false })
    expect(h.specs[0]!.args).toEqual(['run', '--machine', '-d', 'emulator-5554', '-t', 'lib/main.dart', '--debug'])
    expect(stateList(h.states)).toEqual(['starting', 'running'])
    const patches = Object.assign({}, ...h.states.map((s) => s.patch ?? {})) as Record<string, unknown>
    expect(patches).toMatchObject({ appId: 'app-1', vmServiceUri: 'ws://127.0.0.1:1/abc=/ws', devtoolsUri: 'http://127.0.0.1:9100', progress: null })
    expect(h.states.some((s) => s.patch?.progress === "Running Gradle task 'assembleDebug'...")).toBe(true)
    expect(h.errors).toEqual([expect.objectContaining({ line: 3, col: 5, severity: 'warning' })])
    expect(h.logs).toContainEqual({ stream: 'build', text: 'lib/main.dart:3:5: Warning: unused import' })

    h.child.msg({ event: 'app.log', params: { appId: 'app-1', log: 'flutter: hello' } })
    h.child.msg({ event: 'app.log', params: { appId: 'app-1', log: 'boom', error: true } })
    h.child.out('plain after start')
    await tick()
    expect(h.logs).toContainEqual({ stream: 'app', text: 'flutter: hello' })
    expect(h.logs).toContainEqual({ stream: 'app', text: 'boom', level: 'E' })
    expect(h.logs).toContainEqual({ stream: 'app', text: 'plain after start' })
  })

  it('late app.started / progress after Stop does not revive the session', async () => {
    const h = harness()
    const started = h.runner.start()
    await tick()
    h.child.msg({ event: 'app.start', params: { appId: 'app-1' } })
    await tick()
    const stopping = h.runner.stop()
    h.child.msg({ event: 'app.progress', params: { appId: 'app-1', message: 'Syncing files' } })
    h.child.msg({ event: 'app.started', params: { appId: 'app-1' } })
    await tick()
    expect(h.states.at(-1)?.state).toBe('stopping')
    await h.child.exit(0)
    await stopping
    await started
    h.child.msg({ event: 'app.started', params: { appId: 'app-1' } })
    await tick()
    expect(stateList(h.states)).toEqual(['starting', 'stopping', 'stopped'])
  })

  it('pipes stdin only for the machine protocol and masks ${env:} values in the logged command', async () => {
    const h = harness({ args: '--dart-define=TOKEN=${env:SECRET}', env: { SECRET: 's3cr3t' } })
    void h.runner.start()
    await tick()
    expect(h.specs[0]!.stdin).toBe('pipe')
    expect(h.specs[0]!.args).toContain('--dart-define=TOKEN=s3cr3t')
    const logged = h.logs.find((l) => l.text.startsWith('> flutter'))!.text
    expect(logged).toContain('--dart-define=TOKEN=***')
    expect(logged).not.toContain('s3cr3t')
    h.runner.kill()
  })

  it('build failure before start → failed build', async () => {
    const h = harness()
    const started = h.runner.start()
    await tick()
    h.child.err('lib/main.dart:10:3: Error: Expected a type.')
    await h.child.exit(1)
    await started
    expect(h.errors[0]).toMatchObject({ line: 10, col: 3, severity: 'error' })
    expect(h.fails).toEqual([{ code: 'build' }])
    expect(stateList(h.states)).toEqual(['starting', 'failed'])
  })

  it('non-zero exit without build errors → failed exit', async () => {
    const h = harness()
    const started = h.runner.start()
    await h.child.exit(3)
    await started
    expect(h.fails).toEqual([{ code: 'exit', detail: '3' }])
  })

  it('missing SDK → failed spawn without spawning', async () => {
    const h = harness({}, { sdk: null })
    await h.runner.start()
    expect(h.specs).toHaveLength(0)
    expect(h.fails).toEqual([{ code: 'spawn', detail: 'flutter-missing' }])
    expect(stateList(h.states)).toEqual(['failed'])
  })

  it('hot reload success and failure', async () => {
    const h = harness()
    await boot(h)
    const ok = h.runner.reload!(false)
    await tick()
    const req = h.child.sent.at(-1)!
    expect(req).toMatchObject({ method: 'app.restart', params: { appId: 'app-1', fullRestart: false, pause: false, reason: 'manual' } })
    expect(h.states.at(-1)!.state).toBe('reloading')
    h.child.msg({ id: req.id, result: { code: 0, message: '' } })
    expect(await ok).toEqual({ ok: true })
    expect(h.states.at(-1)!.state).toBe('running')

    const bad = h.runner.reload!(true)
    await tick()
    const req2 = h.child.sent.at(-1)!
    expect(req2.id).not.toBe(req.id)
    expect(req2).toMatchObject({ params: { fullRestart: true } })
    h.child.msg({ id: req2.id, result: { code: 1, message: 'Hot reload was rejected' } })
    expect(await bad).toEqual({ ok: false, error: { code: 'reload-failed', detail: 'Hot reload was rejected' } })
    expect(h.logs).toContainEqual({ stream: 'app', text: 'Hot reload was rejected', level: 'E' })
    expect(h.states.at(-1)!.state).toBe('running')
  })

  it('reload unsupported outside debug', async () => {
    const h = harness({ mode: 'release' })
    await boot(h)
    expect(await h.runner.reload!(false)).toEqual({ ok: false, error: { code: 'reload-unsupported' } })
  })

  it('stop sends app.stop and resolves on exit', async () => {
    const h = harness()
    await boot(h)
    const stopping = h.runner.stop()
    await tick()
    expect(h.child.sent.at(-1)).toMatchObject({ method: 'app.stop', params: { appId: 'app-1' } })
    h.child.msg({ event: 'app.stop', params: { appId: 'app-1' } })
    await h.child.exit(0)
    await stopping
    expect(h.runner.stop()).toBe(stopping)
    expect(h.kill).not.toHaveBeenCalled()
    expect(stateList(h.states).slice(-2)).toEqual(['stopping', 'stopped'])
  })

  it('stop timeout kills the tree', async () => {
    const h = harness()
    await boot(h)
    const stopping = h.runner.stop()
    await new Promise((r) => setTimeout(r, 40))
    expect(h.kill).toHaveBeenCalledWith(h.child)
    await h.child.exit(null)
    await stopping
    expect(h.states.at(-1)!.state).toBe('stopped')
  })

  it('kill() is sync', async () => {
    const h = harness()
    await boot(h)
    h.runner.kill()
    expect(h.kill).toHaveBeenCalledWith(h.child, true)
  })

  it('unexpected exit after running: device lost vs plain stop', async () => {
    const h = harness()
    await boot(h)
    h.child.err('Lost connection to device.')
    await h.child.exit(1)
    expect(h.fails).toEqual([{ code: 'device-lost' }])
    expect(h.states.at(-1)!.state).toBe('stopped')

    const h2 = harness()
    await boot(h2)
    await h2.child.exit(0)
    expect(h2.fails).toEqual([])
    expect(h2.states.at(-1)!.state).toBe('stopped')
  })

  it('beforeLaunch runs flutter from the SDK, failure stops the run', async () => {
    const step = fakeChild()
    const h = harness({ beforeLaunch: ['flutter pub get', 'dart run build_runner build'] }, { children: [step] })
    const started = h.runner.start()
    await tick()
    expect(h.specs[0]).toMatchObject({ file: '/sdk/bin/flutter', args: ['pub', 'get'] })
    expect(h.states[0]!.state).toBe('before-launch')
    await step.exit(1)
    await started
    expect(h.specs).toHaveLength(1)
    expect(h.fails).toEqual([{ code: 'before-launch', detail: 'flutter' }])
    expect(h.states.at(-1)!.state).toBe('failed')
  })

  it('stop during beforeLaunch cancels', async () => {
    const step = fakeChild()
    const h = harness({ beforeLaunch: ['dart --version'] }, { children: [step] })
    const started = h.runner.start()
    await tick()
    expect(h.specs[0]).toMatchObject({ file: '/sdk/bin/dart', args: ['--version'] })
    await h.runner.stop()
    expect(h.kill).toHaveBeenCalledWith(step)
    await step.exit(null)
    await started
    expect(h.fails).toEqual([])
    expect(h.states.at(-1)!.state).toBe('cancelled')
  })
})

describe('flutter devices', () => {
  function devicesHarness(children: FakeChild[]) {
    const specs: SpawnSpec[] = []
    let i = 0
    const kill = vi.fn()
    const svc = createFlutterDevices({
      settings: { flutterSdk: null, androidSdk: null, jdk: null },
      env: {},
      platform: 'linux',
      home: '/home/u',
      sdkFor: () => '/sdk',
      kill,
      firstBatchMs: 30,
      spawn: (spec) => {
        specs.push(spec)
        const c = children[i++]
        if (!c) throw new Error('no more children')
        return c
      },
    })
    return { svc, specs, kill }
  }

  it('daemon: device.enable, add/remove, emulators, launch, shutdown', async () => {
    const d = fakeChild()
    const { svc, specs } = devicesHarness([d])
    const changes: string[][] = []
    svc.onChange((list) => changes.push(list.map((x) => x.id)))
    const listing = svc.list()
    await tick()
    expect(specs[0]).toMatchObject({ file: '/sdk/bin/flutter', args: ['daemon'] })
    expect(d.sent.map((m) => m.method)).toEqual(['device.enable', 'device.getDevices'])
    d.msg({ id: d.sent[1]!.id, result: [] })
    d.msg({ event: 'device.added', params: { id: 'emulator-5554', name: 'sdk gphone', platform: 'android-x64', emulator: true } })
    d.msg({ event: 'device.added', params: { id: 'chrome', name: 'Chrome', platform: 'web-javascript', emulator: false } })
    const list = await listing
    expect(list.map((x) => x.id)).toEqual(['emulator-5554', 'chrome'])
    expect(list[0]).toMatchObject({ emulator: true, source: 'flutter', state: 'ready' })

    d.msg({ event: 'device.removed', params: { id: 'chrome' } })
    await tick()
    expect(changes.at(-1)).toEqual(['emulator-5554'])
    expect((await svc.list()).map((x) => x.id)).toEqual(['emulator-5554'])

    const emus = svc.emulators()
    await tick()
    const req = d.sent.at(-1)!
    expect(req.method).toBe('emulator.getEmulators')
    d.msg({ id: req.id, result: [{ id: 'Pixel_7', name: 'Pixel 7', category: 'mobile', platformType: 'android' }] })
    expect(await emus).toEqual([{ id: 'Pixel_7', name: 'Pixel 7', source: 'flutter' }])

    const launch = svc.launchEmulator('Pixel_7')
    await tick()
    const lreq = d.sent.at(-1)!
    expect(lreq).toMatchObject({ method: 'emulator.launch', params: { emulatorId: 'Pixel_7' } })
    d.msg({ id: lreq.id, result: null })
    expect(await launch).toEqual({ ok: true })

    svc.stop()
    await tick()
    expect(d.sent.at(-1)!.method).toBe('daemon.shutdown')
    await d.exit(0)
  })

  it('first batch times out with no devices; dead daemon falls back to devices --machine', async () => {
    const d = fakeChild()
    const cli = fakeChild()
    const { svc, specs } = devicesHarness([d, cli])
    const first = svc.list()
    await tick()
    await d.exit(1)
    const pending = first
    await tick()
    cli.out('Waiting for flutter...')
    cli.out(JSON.stringify([{ id: 'macos', name: 'macOS', targetPlatform: 'darwin', emulator: false }]))
    await cli.exit(0)
    const list = await pending
    expect(specs[1]).toMatchObject({ args: ['devices', '--machine'] })
    expect(list).toEqual([expect.objectContaining({ id: 'macos', platform: 'darwin' })])
  })

  it('caps daemon restarts at 3 per window', async () => {
    const kids: FakeChild[] = []
    const svc = createFlutterDevices({
      settings: { flutterSdk: null, androidSdk: null, jdk: null },
      env: {},
      platform: 'linux',
      home: '/home/u',
      sdkFor: () => '/sdk',
      kill: vi.fn(),
      firstBatchMs: 30,
      spawn: () => {
        const c = fakeChild()
        kids.push(c)
        setTimeout(() => c.emit('close', 1), 5)
        return c
      },
    })
    const daemons = (): number => kids.filter((k) => k.sent.some((m) => m.method === 'device.enable')).length
    for (let n = 0; n < 6; n++) {
      await svc.list()
    }
    expect(daemons()).toBe(4)
  })
})
