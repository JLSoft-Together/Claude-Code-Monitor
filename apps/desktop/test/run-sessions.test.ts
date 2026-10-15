import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { RunDevice, RunEvent } from '@ccm/shared'
import { RunManager } from '../src/run/sessions'
import type { DeviceService, RunContext, Runner } from '../src/run/types'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-run-sessions-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function project(): string {
  const root = path.join(tmp, `p${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  mkdirSync(path.join(root, 'android'), { recursive: true })
  writeFileSync(path.join(root, 'pubspec.yaml'), 'name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n')
  writeFileSync(path.join(root, '.metadata'), 'project_type: app\n')
  writeFileSync(path.join(root, 'lib', 'main.dart'), 'void main() {}\n')
  return root
}

const phone: RunDevice = { id: 'R58', name: 'Galaxy', platform: 'android-arm64', emulator: false, state: 'ready', source: 'flutter' }

function devices(list: RunDevice[]): DeviceService {
  return { list: async () => list, onChange: () => () => undefined, emulators: async () => [], launchEmulator: async () => ({ ok: true }), stop: () => undefined }
}

function setup() {
  const events: RunEvent[] = []
  const contexts: RunContext[] = []
  const stops: string[] = []
  const fake = (ctx: RunContext): Runner => {
    contexts.push(ctx)
    return {
      start: async () => {
        ctx.hooks.state('building')
        ctx.hooks.log({ stream: 'build', text: 'compiling' })
        ctx.hooks.state('running', { appId: 'app-1' })
      },
      stop: async () => {
        stops.push(ctx.config.id)
        ctx.hooks.state('stopped')
      },
      kill: () => undefined,
    }
  }
  const manager = new RunManager({
    dataDir: path.join(tmp, 'data'),
    env: {},
    platform: process.platform,
    home: tmp,
    spawn: () => {
      throw new Error('no spawn in tests')
    },
    runners: { flutter: fake, android: fake, custom: fake },
    devices: { flutter: () => devices([phone]), adb: () => devices([{ ...phone, source: 'adb', platform: 'android', state: 'unauthorized' }]) },
    broadcast: (e) => events.push(e),
    confirm: async () => true,
  })
  return { manager, events, contexts, stops }
}

describe('RunManager', () => {
  it('default configs come from detection', async () => {
    const { manager } = setup()
    const root = project()
    const configs = await manager.configs(root)
    expect(configs).toHaveLength(1)
    expect(configs[0]).toMatchObject({ type: 'flutter', entrypoint: 'lib/main.dart', cwd: root })
  })

  it('merges adb state into flutter devices', async () => {
    const { manager } = setup()
    expect(await manager.devices()).toEqual([{ ...phone, state: 'unauthorized' }])
  })

  it('start broadcasts session states and batched logs; same pair restarts', async () => {
    const { manager, events, stops } = setup()
    const root = project()
    const [cfg] = await manager.configs(root)
    await manager.devices()
    const res = await manager.start({ root, configId: cfg!.id, deviceId: 'R58' })
    expect(res.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 150))
    const states = events.flatMap((e) => (e.type === 'session' ? [e.session.state] : []))
    expect(states).toEqual(['starting', 'building', 'running'])
    expect(events.some((e) => e.type === 'log' && e.lines[0]?.text === 'compiling')).toBe(true)
    expect(manager.live()[0]).toMatchObject({ appId: 'app-1', deviceName: 'Galaxy' })

    await manager.start({ root, configId: cfg!.id, deviceId: 'R58' })
    expect(stops).toEqual([cfg!.id])
    expect(manager.live()).toHaveLength(1)
  })

  it('rejects unknown config / missing device', async () => {
    const { manager } = setup()
    const root = project()
    expect(await manager.start({ root, configId: 'nope', deviceId: 'R58' })).toEqual({ ok: false, error: { code: 'config-missing' } })
    const [cfg] = await manager.configs(root)
    expect(await manager.start({ root, configId: cfg!.id, deviceId: null })).toEqual({ ok: false, error: { code: 'device-missing' } })
  })

  it('a failure is not overwritten by a later stopped', async () => {
    const { manager, contexts } = setup()
    const root = project()
    const [cfg] = await manager.configs(root)
    await manager.devices()
    const res = await manager.start({ root, configId: cfg!.id, deviceId: 'R58' })
    const ctx = contexts[0]!
    ctx.hooks.fail({ code: 'build' })
    ctx.hooks.state('stopped')
    const s = manager.list().find((x) => x.id === (res.ok ? res.sessionId : ''))
    expect(s).toMatchObject({ state: 'failed', failure: { code: 'build' } })
  })

  it('settings persist and reject relative paths', async () => {
    const { manager } = setup()
    await manager.setSettings({ flutterSdk: path.join(tmp, 'flutter'), jdk: 'relative/jdk' })
    const again = setup().manager
    await again.loadSettings()
    expect(again.getSettings()).toEqual({ flutterSdk: path.join(tmp, 'flutter'), androidSdk: null, jdk: null, flutterSdkProjects: {}, layoutAutoCompile: true })
    await again.setSettings({ layoutAutoCompile: false })
    const off = setup().manager
    await off.loadSettings()
    expect(off.getSettings().layoutAutoCompile).toBe(false)
  })
})

function manager(opts: { runner?: (ctx: RunContext) => Runner; confirm?: (code: string, detail?: string) => Promise<boolean>; emulators?: string[] } = {}) {
  const events: RunEvent[] = []
  const confirms: { code: string; detail?: string }[] = []
  const contexts: RunContext[] = []
  const simple = (ctx: RunContext): Runner => ({ start: async () => ctx.hooks.state('running'), stop: async () => ctx.hooks.state('stopped'), kill: () => undefined })
  const track = (make: (ctx: RunContext) => Runner) => (ctx: RunContext): Runner => {
    contexts.push(ctx)
    return make(ctx)
  }
  const m = new RunManager({
    dataDir: path.join(tmp, `data-${Math.random().toString(36).slice(2, 8)}`),
    env: {},
    platform: process.platform,
    home: tmp,
    spawn: () => {
      throw new Error('no spawn in tests')
    },
    runners: { flutter: track(opts.runner ?? simple), android: track(simple), custom: track(simple) },
    devices: {
      flutter: () => ({ ...devices([phone]), emulators: async () => (opts.emulators ?? []).map((id) => ({ id, name: id, source: 'flutter' as const })) }),
      adb: () => devices([]),
    },
    broadcast: (e) => events.push(e),
    confirm: async (code, detail) => {
      confirms.push({ code, detail })
      return opts.confirm ? opts.confirm(code, detail) : true
    },
    restartStopMs: 50,
  })
  return { m, events, confirms, contexts }
}

describe('RunManager hardening', () => {
  it('a double Run on the same pair starts only one session', async () => {
    const { m } = manager()
    const root = project()
    const [cfg] = await m.configs(root)
    await m.devices()
    const [a, b] = await Promise.all([m.start({ root, configId: cfg!.id, deviceId: 'R58' }), m.start({ root, configId: cfg!.id, deviceId: 'R58' })])
    expect(a.ok).toBe(true)
    expect(b).toEqual({ ok: false, error: { code: 'run-pending' } })
    expect(m.list()).toHaveLength(1)
  })

  it('a restart kills a runner whose stop hangs, and marks it stopped', async () => {
    const kills: string[] = []
    const { m } = manager({
      runner: (ctx) => ({ start: async () => ctx.hooks.state('running'), stop: () => new Promise(() => undefined), kill: () => void kills.push(ctx.config.id) }),
    })
    const root = project()
    const [cfg] = await m.configs(root)
    await m.devices()
    const first = await m.start({ root, configId: cfg!.id, deviceId: 'R58' })
    await new Promise((r) => setTimeout(r, 5))
    const second = await m.start({ root, configId: cfg!.id, deviceId: 'R58' })
    expect(second.ok).toBe(true)
    expect(kills).toEqual([cfg!.id])
    expect(m.list().find((s) => s.id === (first.ok ? first.sessionId : ''))?.state).toBe('stopped')
    expect(m.live()).toHaveLength(1)
  })

  it('ignores runner reports once the session ended; progress ticks are batched', async () => {
    const { m, events, contexts } = manager({ runner: (ctx) => ({ start: async () => ctx.hooks.state('running'), stop: async () => undefined, kill: () => undefined }) })
    const root = project()
    const [cfg] = await m.configs(root)
    await m.devices()
    const res = await m.start({ root, configId: cfg!.id, deviceId: 'R58' })
    const id = res.ok ? res.sessionId! : ''
    const ctx = contexts[0]!
    await new Promise((r) => setTimeout(r, 5))
    const before = events.length
    for (let i = 0; i < 5; i++) ctx.hooks.state('running', { progress: `p${i}` })
    expect(events.length).toBe(before)
    await new Promise((r) => setTimeout(r, 150))
    const batched = events.slice(before).flatMap((e) => (e.type === 'session' ? [e.session] : []))
    expect(batched.map((s) => s.progress)).toEqual(['p4'])

    ctx.hooks.state('stopped')
    ctx.hooks.state('running', { appId: 'late' })
    ctx.hooks.fail({ code: 'exit' })
    expect(m.list().find((s) => s.id === id)).toMatchObject({ state: 'stopped', appId: null, failure: null })
  })

  it('stored configs come first; detected defaults stay listed under them', async () => {
    const { m } = manager()
    const root = project()
    const [auto] = await m.configs(root)
    await m.saveConfig(root, { type: 'custom', name: 'zz custom', cwd: root, command: 'node -v' })
    expect((await m.configs(root)).map((c) => c.name)).toEqual(['zz custom', auto!.name])
    await m.saveConfig(root, { ...auto!, name: 'renamed' })
    expect((await m.configs(root)).filter((c) => c.id === auto!.id)).toEqual([expect.objectContaining({ name: 'renamed' })])
  })

  it('import is idempotent', async () => {
    const { m } = manager()
    const root = project()
    mkdirSync(path.join(root, '.vscode'))
    writeFileSync(path.join(root, '.vscode', 'launch.json'), JSON.stringify({ configurations: [{ name: 'dev', type: 'dart', program: 'lib/main.dart' }] }))
    expect(await m.importConfigs(root)).toHaveLength(1)
    expect(await m.importConfigs(root)).toEqual([])
    expect((await m.configs(root)).filter((c) => c.id.startsWith('imp-'))).toHaveLength(1)
  })

  it('shared configs need a confirm per content hash; cancel means untrusted; blocked env keys are dropped', async () => {
    let answer = false
    const { m, confirms, contexts } = manager({ confirm: async () => answer })
    const root = project()
    const saved = await m.saveConfig(root, { type: 'custom', name: 'team', cwd: root, command: 'node -v ${env:TOKEN}', shared: true, beforeLaunch: ['npm ci'], env: { TOKEN: 'x', PATH: '/evil', NODE_OPTIONS: '-r hook' } })
    expect(saved?.env).toEqual({ TOKEN: 'x' })
    expect(await m.start({ root, configId: saved!.id, deviceId: null })).toEqual({ ok: false, error: { code: 'untrusted' } })
    expect(confirms).toHaveLength(1)
    const detail = JSON.parse(confirms[0]!.detail!) as Record<string, unknown>
    expect(detail).toMatchObject({ name: 'team', beforeLaunch: ['npm ci'], envKeys: ['TOKEN'], command: 'node -v ***' })

    answer = true
    expect((await m.start({ root, configId: saved!.id, deviceId: null })).ok).toBe(true)
    expect(contexts.at(-1)!.config.env).toEqual({ TOKEN: 'x' })
    expect((await m.start({ root, configId: saved!.id, deviceId: null })).ok).toBe(true)
    expect(confirms).toHaveLength(2)

    await m.saveConfig(root, { ...saved!, command: 'node -e "evil()"' })
    await m.start({ root, configId: saved!.id, deviceId: null })
    expect(confirms).toHaveLength(3)
    expect(confirms.every((c) => c.code === 'trust-config')).toBe(true)
  })

  it('personal configs run without a trust prompt', async () => {
    const { m, confirms } = manager()
    const root = project()
    const saved = await m.saveConfig(root, { type: 'custom', name: 'mine', cwd: root, command: 'node -v' })
    expect((await m.start({ root, configId: saved!.id, deviceId: null })).ok).toBe(true)
    expect(confirms).toEqual([])
  })

  it('refuses a cwd whose real path leaves the root', async () => {
    const { m } = manager()
    const root = project()
    const outside = path.join(tmp, `out${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(outside)
    try {
      symlinkSync(outside, path.join(root, 'link'), 'junction')
    } catch {
      return
    }
    const saved = await m.saveConfig(root, { type: 'custom', name: 'via link', cwd: path.join(root, 'link'), command: 'node -v' })
    expect(await m.start({ root, configId: saved!.id, deviceId: null })).toEqual({ ok: false, error: { code: 'cwd-outside', detail: path.join(root, 'link') } })
  })

  it('launchEmulator only accepts ids the tools listed', async () => {
    const { m } = manager({ emulators: ['Pixel_7'] })
    expect(await m.launchEmulator('-netdelay', 'flutter')).toEqual({ ok: false, error: { code: 'emulator-missing' } })
    expect(await m.launchEmulator('Other', 'flutter')).toEqual({ ok: false, error: { code: 'emulator-missing' } })
    expect(await m.launchEmulator('Pixel_7', 'flutter')).toEqual({ ok: true })
  })
})
