import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AdbMdnsService, DevEvent, DevResult } from '@ccm/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdbCommands } from '../src/devices/adb'
import { DeviceHistory } from '../src/devices/history'
import { DeviceManager, mapLimit, mergeDevices, type DeviceManagerDeps } from '../src/devices/manager'
import { parseAdbDeviceRows } from '../src/devices/parse'
import type { EnvDeps } from '../src/run/android/env'
import { killTree, type SpawnSpec, type Spawner } from '../src/run/proc'

vi.mock('../src/run/proc', async (orig) => {
  const mod = await orig<typeof import('../src/run/proc')>()
  return {
    ...mod,
    killTree: vi.fn((child: FakeChild) => {
      if (child.exitCode !== null) return
      child.exitCode = -1
      process.nextTick(() => child.emit('close', null))
    }),
  }
})

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

const stream = (): EventEmitter & { resume: () => void } => Object.assign(new EventEmitter(), { resume: () => undefined })

/** `child.kill`: the pid-only kill adb clients get. */
function fakeKill(this: FakeChild): boolean {
  if (this.exitCode !== null) return false
  this.exitCode = -1
  process.nextTick(() => this.emit('close', null))
  return true
}
const frame = (body: string): string => body.length.toString(16).padStart(4, '0') + body

/** Every `track-devices` child stays alive and first reports `devices`; other commands exit 0. */
function fakeSpawn(devices: string): { spawn: Spawner; calls: FakeChild[]; keys: () => string[] } {
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
      kill: vi.fn(fakeKill),
      out(text: string) {
        child.stdout.emit('data', Buffer.from(text))
      },
      exit(code: number) {
        child.exitCode = code
        child.emit('close', code)
      },
    }) as FakeChild
    calls.push(child)
    process.nextTick(() => {
      if (key.includes('track-devices')) return child.out(frame(devices))
      if (key.endsWith('devices -l')) child.out(devices)
      child.exit(0)
    })
    return child as unknown as ChildProcess
  }
  return { spawn, calls, keys: () => calls.map((c) => c.key) }
}

const sdkDeps = (sdk: string): EnvDeps => ({
  isFile: async (f) => f === `${sdk}/platform-tools/adb`,
  readText: async () => null,
  mode: async () => null,
  exec: async () => null,
})

const LIVE = ['R58M123ABC          device usb:1-1 product:beyond1 model:SM_G973F device:beyond1 transport_id:1', '192.168.1.5:5555     device product:x model:Pixel_7 device:x transport_id:2'].join('\n')

const tmpDirs: string[] = []
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function history(seed?: Record<string, { alias?: string | null; model?: string | null; wifi: boolean; lastSeen?: number }>): DeviceHistory {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-devmgr-'))
  tmpDirs.push(dir)
  const file = path.join(dir, 'adb-devices.json')
  const h = new DeviceHistory(file)
  if (seed) {
    const all = h.all()
    for (const [id, e] of Object.entries(seed)) all[id] = { alias: e.alias ?? null, model: e.model ?? null, wifi: e.wifi, lastSeen: e.lastSeen ?? 1 }
  }
  return h
}

function fakeCommands(over: Partial<AdbCommands> = {}): AdbCommands & { log: string[] } {
  const log: string[] = []
  return {
    log,
    connect: vi.fn(async (t: string) => (log.push(`connect ${t}`), { ok: true } as DevResult)),
    pair: vi.fn(async (hp: string) => (log.push(`pair ${hp}`), { ok: true } as DevResult)),
    disconnect: vi.fn(async (id: string) => (log.push(`disconnect ${id}`), { ok: true } as DevResult)),
    tcpip: vi.fn(async (id: string, port: number) => (log.push(`tcpip ${id} ${port}`), { ok: true } as DevResult)),
    wlanIp: vi.fn(async (id: string) => (log.push(`wlanIp ${id}`), '192.168.1.5')),
    mdnsCheck: vi.fn(async () => true),
    mdnsServices: vi.fn(async () => [] as AdbMdnsService[]),
    list: vi.fn(async () => parseAdbDeviceRows(LIVE)),
    ...over,
  } as AdbCommands & { log: string[] }
}

function setup(opts: { devices?: string; hist?: DeviceHistory; sdk?: { value: string | null }; adb?: boolean; commands?: AdbCommands; timing?: DeviceManagerDeps['timing']; confirm?: boolean } = {}) {
  const fake = fakeSpawn(opts.devices ?? LIVE)
  const events: DevEvent[] = []
  const sdk = opts.sdk ?? { value: '/sdk' }
  const hist = opts.hist ?? history()
  const confirmRemove = vi.fn(async () => opts.confirm ?? true)
  const mgr = new DeviceManager({
    spawn: fake.spawn,
    env: {},
    platform: 'linux',
    home: '/home/u',
    getSettings: () => ({ androidSdk: sdk.value }),
    history: hist,
    broadcast: (e) => events.push(e),
    confirmRemove,
    timing: { wifiSwitchMs: 0, ...opts.timing },
    commands: opts.commands,
    envDeps: opts.adb === false ? sdkDeps('/nowhere') : sdkDeps('/sdk'),
  })
  return { mgr, fake, events, hist, sdk, confirmRemove }
}

describe('mergeDevices', () => {
  it('merge keeps usb and wifi rows and hides history duplicates', () => {
    const hist = history({ '192.168.1.5:5555': { alias: 'Lab', wifi: true }, '192.168.1.9:5555': { wifi: true, model: 'Old' } })
    const merged = mergeDevices(parseAdbDeviceRows(LIVE), hist.all())
    expect(merged.map((d) => [d.name, d.id, d.online, d.state, d.transport])).toEqual([
      ['Lab', '192.168.1.5:5555', true, 'ready', 'wifi'],
      ['SM G973F', 'R58M123ABC', true, 'ready', 'usb'],
      ['Old', '192.168.1.9:5555', false, 'offline', 'wifi'],
    ])
  })
})

describe('mapLimit', () => {
  it('keeps input order', async () => {
    expect(await mapLimit([3, 1, 2], 2, async (n) => n * 2)).toEqual([6, 2, 4])
  })
})

describe('DeviceManager', () => {
  it('snapshot reports adb:null and actions return adb-missing', async () => {
    const { mgr, fake } = setup({ adb: false, hist: history({ '192.168.1.9:5555': { wifi: true } }) })
    const snap = await mgr.snapshot()
    expect(snap.adb).toBeNull()
    expect(snap.devices.map((d) => d.id)).toEqual(['192.168.1.9:5555'])
    expect(await mgr.connect('192.168.1.9')).toEqual({ ok: false, error: 'adb-missing' })
    expect(await mgr.pair('192.168.1.9:37000', '123456')).toEqual({ ok: false, error: 'adb-missing' })
    expect(await mgr.toWifi('R58M123ABC')).toEqual({ ok: false, error: 'adb-missing' })
    expect(await mgr.disconnect(['a:1'])).toEqual([{ id: 'a:1', result: { ok: false, error: 'adb-missing' } }])
    expect(await mgr.remove(['192.168.1.9:5555'])).toEqual({ ok: false, error: 'adb-missing' })
    expect(await mgr.connectMany(['1.2.3.4:5555'])).toEqual([{ id: '1.2.3.4:5555', result: { ok: false, error: 'adb-missing' } }])
    expect(await mgr.discover()).toEqual({ ok: false, error: 'adb-missing' })
    expect(fake.calls).toHaveLength(0)
  })

  it('reads devices without a tracker while nothing is held', async () => {
    const hist = history({ '192.168.1.9:5555': { wifi: true } })
    const { mgr, fake, confirmRemove } = setup({ hist })
    expect((await mgr.snapshot()).devices.map((d) => d.id)).toContain('R58M123ABC')
    await mgr.disconnect(['192.168.1.5:5555'])
    expect(fake.keys()).toContain('adb disconnect 192.168.1.5:5555')
    expect(await mgr.remove(['192.168.1.5:5555', '192.168.1.9:5555'])).toEqual({ ok: true })
    expect(confirmRemove).toHaveBeenCalledWith(['192.168.1.9:5555'])
    expect(fake.keys().some((k) => k.includes('track-devices'))).toBe(false)
    expect(fake.keys().filter((k) => k.endsWith('devices -l'))).toHaveLength(3)
  })

  it('does not treat devices as offline when the live set is unknown', async () => {
    const hist = history({ '192.168.1.5:5555': { wifi: true } })
    const commands = fakeCommands({ list: vi.fn(async () => null) })
    const { mgr, confirmRemove } = setup({ commands, hist })
    expect(await mgr.remove(['192.168.1.5:5555'])).toEqual({ ok: false, error: 'adb-missing' })
    expect(confirmRemove).not.toHaveBeenCalled()
    expect(await mgr.disconnect(['192.168.1.5:5555'])).toEqual([{ id: '192.168.1.5:5555', result: { ok: false, error: 'not-connected' } }])
    expect((await mgr.snapshot()).devices.map((d) => d.online)).toEqual([false])
  })

  it('connect rejects bad addresses without spawning', async () => {
    const { mgr, fake } = setup()
    expect(await mgr.connect('-s x')).toEqual({ ok: false, error: 'invalid' })
    expect(fake.calls).toHaveLength(0)
  })

  it('connect spawns adb connect for a valid address', async () => {
    const { mgr, fake } = setup()
    await mgr.connect('192.168.1.5')
    expect(fake.keys()).toEqual(['adb connect 192.168.1.5:5555'])
  })

  it('pair then connects through mdns', async () => {
    const commands = fakeCommands({
      mdnsServices: vi.fn(async () => [{ name: 'adb-1', kind: 'connect', host: '192.168.1.5', port: 37123 }] as AdbMdnsService[]),
    })
    const { mgr } = setup({ commands })
    expect(await mgr.pair('192.168.1.5:40000', '12345')).toEqual({ ok: false, error: 'invalid' })
    const r = await mgr.pair('192.168.1.5:40000', '123456')
    expect(r).toEqual({ ok: true })
    expect(commands.log).toEqual(['pair 192.168.1.5:40000', 'connect 192.168.1.5:37123'])
  })

  it('pair without mdns returns paired', async () => {
    const commands = fakeCommands()
    const { mgr } = setup({ commands })
    expect(await mgr.pair('192.168.1.5:40000', '123456')).toEqual({ ok: true, detail: 'paired' })
    expect(commands.log).toEqual(['pair 192.168.1.5:40000'])
  })

  it('toWifi runs ip, tcpip, then connect', async () => {
    const commands = fakeCommands()
    const { mgr } = setup({ commands })
    expect(await mgr.toWifi('R58M123ABC')).toEqual({ ok: true })
    expect(commands.log).toEqual(['wlanIp R58M123ABC', 'tcpip R58M123ABC 5555', 'connect 192.168.1.5:5555'])
    const none = fakeCommands({ wlanIp: vi.fn(async () => null) })
    expect(await setup({ commands: none }).mgr.toWifi('R58M123ABC')).toEqual({ ok: false, error: 'no-ip' })
  })

  it('connectMany caps concurrency at 5 and returns per-id results', async () => {
    let inflight = 0
    let max = 0
    const commands = fakeCommands({
      connect: vi.fn(async (t: string) => {
        inflight++
        max = Math.max(max, inflight)
        await new Promise((r) => setTimeout(r, 1))
        inflight--
        return t === '10.0.0.3:5555' ? ({ ok: false, error: 'connect-failed' } as DevResult) : { ok: true }
      }),
    })
    const { mgr } = setup({ commands })
    const ids = Array.from({ length: 12 }, (_, i) => `10.0.0.${i}:5555`)
    const res = await mgr.connectMany(ids)
    expect(max).toBe(5)
    expect(res.map((r) => r.id)).toEqual(ids)
    expect(res[3]!.result).toEqual({ ok: false, error: 'connect-failed' })
    expect(res.filter((r) => r.result.ok)).toHaveLength(11)
  })

  it('disconnect only touches online wifi ids', async () => {
    const commands = fakeCommands()
    const { mgr } = setup({ commands })
    const res = await mgr.disconnect(['192.168.1.5:5555', 'R58M123ABC', '192.168.1.9:5555'])
    expect(res.map((r) => r.result.ok)).toEqual([true, false, false])
    expect(res[1]!.result).toEqual({ ok: false, error: 'not-connected' })
    expect(commands.log).toEqual(['disconnect 192.168.1.5:5555'])
  })

  it('remove asks confirm and keeps online ids', async () => {
    const hist = history({ '192.168.1.5:5555': { wifi: true }, '192.168.1.9:5555': { wifi: true } })
    const denied = setup({ hist, confirm: false })
    expect(await denied.mgr.remove(['192.168.1.9:5555'])).toEqual({ ok: false, error: 'cancelled' })
    expect(Object.keys(hist.all())).toHaveLength(2)

    const ok = setup({ hist })
    expect(await ok.mgr.remove(['192.168.1.5:5555', '192.168.1.9:5555'])).toEqual({ ok: true })
    expect(ok.confirmRemove).toHaveBeenCalledWith(['192.168.1.9:5555'])
    expect(Object.keys(hist.all())).toEqual(['192.168.1.5:5555'])
    expect(ok.events.at(-1)).toMatchObject({ type: 'devices' })
  })

  it('Object.prototype names are not history ids', async () => {
    const { mgr, confirmRemove, events } = setup()
    expect(await mgr.remove(['toString', 'constructor'])).toEqual({ ok: true })
    expect(confirmRemove).not.toHaveBeenCalled()
    expect(mgr.setAlias('constructor', 'x')).toEqual({ ok: false, error: 'invalid' })
    expect((Object as unknown as { alias?: unknown }).alias).toBeUndefined()
    expect(events).toHaveLength(0)
  })

  it('discover skips connected devices', async () => {
    const commands = fakeCommands({
      mdnsServices: vi.fn(async () => [
        { name: 'adb-p', kind: 'connect', host: '192.168.1.5', port: 5555 },
        { name: 'adb-q', kind: 'legacy', host: '192.168.1.7', port: 5555 },
        { name: 'adb-r', kind: 'pairing', host: '192.168.1.8', port: 40000 },
      ] as AdbMdnsService[]),
    })
    const { mgr } = setup({ commands })
    const res = await mgr.discover()
    expect(res).toEqual([{ id: '192.168.1.7:5555', result: { ok: true } }])
    expect(commands.log).toEqual(['connect 192.168.1.7:5555'])

    const off = setup({ commands: fakeCommands({ mdnsCheck: vi.fn(async () => false) }) })
    expect(await off.mgr.discover()).toEqual({ ok: false, error: 'mdns-unavailable' })
    const none = setup({ commands: fakeCommands() })
    expect(await none.mgr.discover()).toEqual({ ok: false, error: 'no-devices' })
  })

  it('autoConnectOnce runs once and only with wifi history', async () => {
    const empty = fakeCommands()
    await setup({ commands: empty, hist: history({ R58M123ABC: { wifi: false } }) }).mgr.autoConnectOnce()
    expect(empty.log).toEqual([])

    const hist = history({ '192.168.1.9:5555': { wifi: true }, R58M123ABC: { wifi: false } })
    const commands = fakeCommands()
    const { mgr, events } = setup({ commands, hist })
    await mgr.autoConnectOnce()
    await mgr.autoConnectOnce()
    expect(commands.log).toEqual(['connect 192.168.1.9:5555'])
    expect(events).toEqual([])

    const off = history({ '192.168.1.9:5555': { wifi: true } })
    off.setAutoConnect(false)
    const none = fakeCommands()
    await setup({ commands: none, hist: off }).mgr.autoConnectOnce()
    expect(none.log).toEqual([])
  })

  it('broadcasts the merged list on live updates, alias and auto-connect changes', async () => {
    const hist = history({ '192.168.1.5:5555': { wifi: true } })
    const { mgr, events } = setup({ hist })
    await mgr.hold('7:view', true)
    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toMatchObject({ type: 'devices' })
    expect((events[0] as Extract<DevEvent, { type: 'devices' }>).devices).toHaveLength(2)
    expect(hist.all()['R58M123ABC']).toBeDefined()
    expect(mgr.setAlias('192.168.1.5:5555', 'Lab')).toEqual({ ok: true })
    expect((events.at(-1) as Extract<DevEvent, { type: 'devices' }>).devices[0]!.name).toBe('Lab')
    const n = events.length
    mgr.setAlias('192.168.1.5:5555', 'Lab')
    mgr.setAutoConnect(true)
    expect(events).toHaveLength(n)
    mgr.setAutoConnect(false)
    expect(events).toHaveLength(n + 1)
    expect(mgr.setAlias('nope', 'x')).toEqual({ ok: false, error: 'invalid' })
    mgr.stop()
  })

  it('releaseOwner by prefix stops the tracker with the last hold', async () => {
    vi.mocked(killTree).mockClear()
    const { mgr, fake } = setup()
    await mgr.hold('7:view', true)
    await mgr.hold('7:other', true)
    await mgr.hold('8:view', true)
    await vi.waitFor(() => expect(fake.keys().filter((k) => k.includes('track-devices'))).toHaveLength(1))
    const tracker = fake.calls.find((c) => c.key.includes('track-devices'))!
    mgr.releaseOwner('7:')
    expect(tracker.exitCode).toBeNull()
    mgr.releaseOwner('8:')
    expect(tracker.exitCode).toBe(-1)
    expect(tracker.kill).toHaveBeenCalledWith('SIGKILL')
    expect(killTree).not.toHaveBeenCalled()
  })

  it('tracker restarts on sdk change', async () => {
    const sdk = { value: '/sdk' as string | null }
    const fake = fakeSpawn(LIVE)
    const mgr = new DeviceManager({
      spawn: fake.spawn,
      env: {},
      platform: 'linux',
      home: '/home/u',
      getSettings: () => ({ androidSdk: sdk.value }),
      history: history(),
      broadcast: () => undefined,
      confirmRemove: async () => true,
      envDeps: {
        isFile: async (f) => f === '/sdk/platform-tools/adb' || f === '/sdk2/platform-tools/adb',
        readText: async () => null,
        mode: async () => null,
        exec: async () => null,
      },
    })
    await mgr.hold('1:view', true)
    await vi.waitFor(() => expect(fake.calls.filter((c) => c.key.includes('track-devices'))).toHaveLength(1))
    const first = fake.calls.find((c) => c.key.includes('track-devices'))!
    sdk.value = '/sdk2'
    await mgr.hold('2:view', true)
    expect(first.exitCode).toBe(-1)
    await vi.waitFor(() => expect(fake.calls.filter((c) => c.key.includes('track-devices'))).toHaveLength(2))
    mgr.stop()
  })
})
