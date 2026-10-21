import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AdbMdnsService, DevEvent, DevResult, QrStatus } from '@ccm/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdbCommands } from '../src/devices/adb'
import { DeviceHistory } from '../src/devices/history'
import { DeviceManager } from '../src/devices/manager'
import { newQrSecret, qrPayload, runQrPairing } from '../src/devices/qr'
import type { Spawner } from '../src/run/proc'

const NAME = 'orrery-1a2b3c4d'
const timing = { pairWaitMs: 60_000, connectWaitMs: 30_000, pollMs: 1_000 }
const pairing = (name: string, port: number): AdbMdnsService => ({ name, kind: 'pairing', host: '192.168.1.7', port })
const connectSvc = (port: number): AdbMdnsService => ({ name: 'phone', kind: 'connect', host: '192.168.1.7', port })

function cmds(over: Partial<AdbCommands> = {}): AdbCommands {
  return {
    connect: vi.fn(async () => ({ ok: true }) as DevResult),
    pair: vi.fn(async () => ({ ok: true }) as DevResult),
    disconnect: vi.fn(async () => ({ ok: true }) as DevResult),
    tcpip: vi.fn(async () => ({ ok: true }) as DevResult),
    wlanIp: vi.fn(async () => null),
    mdnsCheck: vi.fn(async () => true),
    mdnsServices: vi.fn(async () => [] as AdbMdnsService[]),
    list: vi.fn(async () => []),
    ...over,
  } as AdbCommands
}

function run(c: AdbCommands, over: { lastPortFor?: (h: string) => number | null; signal?: AbortSignal } = {}) {
  const statuses: QrStatus[] = []
  const ctl = new AbortController()
  const p = runQrPairing({
    cmds: c,
    name: NAME,
    password: '012345',
    signal: over.signal ?? ctl.signal,
    onStatus: (s) => statuses.push(s),
    lastPortFor: over.lastPortFor ?? (() => null),
    timing,
  })
  return { p, statuses, ctl }
}

afterEach(() => vi.useRealTimers())

describe('qr secret', () => {
  it('payload format', () => {
    expect(qrPayload(NAME, '012345')).toBe('WIFI:T:ADB;S:orrery-1a2b3c4d;P:012345;;')
    const s = newQrSecret()
    expect(s.name).toMatch(/^orrery-[0-9a-f]{8}$/)
    expect(s.password).toMatch(/^\d{6}$/)
  })
})

describe('runQrPairing', () => {
  it('pairs only with its own service name', async () => {
    vi.useFakeTimers()
    const mdnsServices = vi
      .fn<() => Promise<AdbMdnsService[]>>()
      .mockResolvedValueOnce([pairing('studio-xyz', 1111)])
      .mockResolvedValueOnce([pairing('studio-xyz', 1111), pairing(NAME, 2222)])
      .mockResolvedValue([connectSvc(4000)])
    const c = cmds({ mdnsServices })
    const { p } = run(c)
    await vi.advanceTimersByTimeAsync(1_000)
    await p
    expect(c.pair).toHaveBeenCalledTimes(1)
    expect(c.pair).toHaveBeenCalledWith('192.168.1.7:2222', '012345')
  })

  it('connects via mdns connect service', async () => {
    vi.useFakeTimers()
    const mdnsServices = vi.fn<() => Promise<AdbMdnsService[]>>().mockResolvedValueOnce([pairing(NAME, 2222)]).mockResolvedValue([connectSvc(4000)])
    const c = cmds({ mdnsServices })
    const { p, statuses } = run(c)
    await expect(p).resolves.toEqual({ ok: true })
    expect(statuses).toEqual(['waiting', 'pairing', 'connecting', 'connected'])
    expect(c.connect).toHaveBeenCalledWith('192.168.1.7:4000')
  })

  it('falls back to the remembered port, then 5555', async () => {
    vi.useFakeTimers()
    const mdnsServices = vi.fn<() => Promise<AdbMdnsService[]>>().mockResolvedValueOnce([pairing(NAME, 2222)]).mockResolvedValue([])
    const c = cmds({ mdnsServices, connect: vi.fn(async (t: string) => (t.endsWith(':41000') ? { ok: false, error: 'connect-failed' } : { ok: true }) as DevResult) })
    const { p } = run(c, { lastPortFor: () => 41000 })
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(p).resolves.toEqual({ ok: true })
    expect(vi.mocked(c.connect).mock.calls.map((a) => a[0])).toEqual(['192.168.1.7:41000', '192.168.1.7:5555'])

    const c2 = cmds({ mdnsServices: vi.fn<() => Promise<AdbMdnsService[]>>().mockResolvedValueOnce([pairing(NAME, 2222)]).mockResolvedValue([]) })
    const r2 = run(c2)
    await vi.advanceTimersByTimeAsync(30_000)
    await r2.p
    expect(vi.mocked(c2.connect).mock.calls.map((a) => a[0])).toEqual(['192.168.1.7:5555'])
  })

  it('fails when pairing fails', async () => {
    vi.useFakeTimers()
    const c = cmds({
      mdnsServices: vi.fn(async () => [pairing(NAME, 2222)]),
      pair: vi.fn(async () => ({ ok: false, error: 'pair-failed', detail: 'bad code' }) as DevResult),
    })
    const { p, statuses } = run(c)
    await expect(p).resolves.toMatchObject({ ok: false, error: 'pair-failed' })
    expect(statuses).toEqual(['waiting', 'pairing', 'failed'])
    expect(c.connect).not.toHaveBeenCalled()
  })

  it('times out after pairWaitMs', async () => {
    vi.useFakeTimers()
    const { p, statuses } = run(cmds())
    await vi.advanceTimersByTimeAsync(61_000)
    await expect(p).resolves.toEqual({ ok: false, error: 'timeout' })
    expect(statuses).toEqual(['waiting', 'timeout'])
  })

  it('unexpected errors end with failed', async () => {
    const c = cmds({ mdnsServices: vi.fn(async () => Promise.reject(new Error('nope'))) })
    const { p, statuses } = run(c)
    await expect(p).resolves.toEqual({ ok: false, error: 'pair-failed', detail: 'nope' })
    expect(statuses).toEqual(['waiting', 'failed'])
  })

  it('cancel stops polling', async () => {
    vi.useFakeTimers()
    const c = cmds()
    const { p, statuses, ctl } = run(c)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(c.mdnsServices).toHaveBeenCalledTimes(2)
    ctl.abort()
    await expect(p).resolves.toEqual({ ok: false, error: 'cancelled' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(c.mdnsServices).toHaveBeenCalledTimes(2)
    expect(statuses).toEqual(['waiting', 'cancelled'])
  })
})

describe('DeviceManager qr', () => {
  const tmpDirs: string[] = []
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function setup(c: AdbCommands, adb = true) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-qr-'))
    tmpDirs.push(dir)
    const events: DevEvent[] = []
    const hist = new DeviceHistory(path.join(dir, 'adb-devices.json'))
    const mgr = new DeviceManager({
      spawn: (() => {
        throw new Error('no spawn')
      }) as unknown as Spawner,
      env: {},
      platform: 'linux',
      home: '/home/u',
      getSettings: () => ({ androidSdk: '/sdk' }),
      history: hist,
      broadcast: (e) => events.push(e),
      confirmRemove: async () => true,
      commands: c,
      envDeps: { isFile: async (f) => adb && f === '/sdk/platform-tools/adb', readText: async () => null, mode: async () => null, exec: async () => null },
    })
    return { mgr, events, hist }
  }
  const qrEvents = (events: DevEvent[]) => events.filter((e): e is Extract<DevEvent, { type: 'qr' }> => e.type === 'qr').map((e) => e.status)

  it('mdns unavailable fails fast', async () => {
    const { mgr, events } = setup(cmds({ mdnsCheck: vi.fn(async () => false) }))
    await expect(mgr.qrStart('7:qr')).resolves.toEqual({ ok: false, error: 'mdns-unavailable' })
    expect(events).toEqual([])
  })

  it('reports adb-missing', async () => {
    const { mgr } = setup(cmds(), false)
    await expect(mgr.qrStart('7:qr')).resolves.toEqual({ ok: false, error: 'adb-missing' })
  })

  it('starts in the background and cancels once', async () => {
    vi.useFakeTimers()
    const { mgr, events } = setup(cmds())
    const r = await mgr.qrStart('7:qr')
    if ('ok' in r) throw new Error('expected a session')
    expect(r.id).toMatch(/^orrery-[0-9a-f]{8}$/)
    expect(r.payload).toMatch(new RegExp(`^WIFI:T:ADB;S:${r.id};P:\\d{6};;$`))
    expect(mgr.qrCancel(r.id)).toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(qrEvents(events)).toEqual(['waiting', 'cancelled'])
    expect(mgr.qrCancel(r.id)).toEqual({ ok: false, error: 'invalid' })
  })

  it('window release cancels its QR session', async () => {
    vi.useFakeTimers()
    const { mgr, events } = setup(cmds())
    await mgr.qrStart('7:qr')
    await mgr.qrStart('8:qr')
    mgr.releaseOwner('7:')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(qrEvents(events).filter((s) => s === 'cancelled')).toHaveLength(1)
    mgr.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(qrEvents(events).filter((s) => s === 'cancelled')).toHaveLength(2)
  })

  it('ends with failed and drops the session when adb throws', async () => {
    vi.useFakeTimers()
    const { mgr, events } = setup(cmds({ mdnsServices: vi.fn(async () => Promise.reject(new Error('adb exploded'))) }))
    const r = await mgr.qrStart('7:qr')
    if ('ok' in r) throw new Error('expected a session')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(qrEvents(events)).toEqual(['waiting', 'failed'])
    expect(events.find((e) => e.type === 'qr' && e.status === 'failed')).toMatchObject({ detail: 'adb exploded' })
    expect(mgr.qrCancel(r.id)).toEqual({ ok: false, error: 'invalid' })
  })

  it('a throwing broadcast causes no unhandled rejection', async () => {
    vi.useFakeTimers()
    const seen: unknown[] = []
    const on = (e: unknown): void => void seen.push(e)
    process.on('unhandledRejection', on)
    try {
      const { mgr } = setup(cmds())
      ;(mgr as unknown as { deps: { broadcast: () => void } }).deps.broadcast = () => {
        throw new Error('boom')
      }
      const r = await mgr.qrStart('7:qr')
      if ('ok' in r) throw new Error('expected a session')
      await vi.advanceTimersByTimeAsync(1_000)
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(seen).toEqual([])
      expect(mgr.qrCancel(r.id)).toEqual({ ok: false, error: 'invalid' })
    } finally {
      process.off('unhandledRejection', on)
    }
  })

  it('connect fallback uses the newest remembered non-5555 port', async () => {
    vi.useFakeTimers()
    const c = cmds({ mdnsServices: vi.fn<() => Promise<AdbMdnsService[]>>().mockResolvedValue([]) })
    const { mgr, hist } = setup(c, true)
    Object.assign(hist.all(), {
      '192.168.1.7:5555': { alias: null, model: null, wifi: true, lastSeen: 9 },
      '192.168.1.7:39000': { alias: null, model: null, wifi: true, lastSeen: 1 },
      '192.168.1.7:40000': { alias: null, model: null, wifi: true, lastSeen: 5 },
    })
    const r = await mgr.qrStart('7:qr')
    if ('ok' in r) throw new Error('expected a session')
    vi.mocked(c.mdnsServices).mockResolvedValue([pairing(r.id, 2222)])
    await vi.advanceTimersByTimeAsync(1_000)
    vi.mocked(c.mdnsServices).mockResolvedValue([])
    await vi.advanceTimersByTimeAsync(31_000)
    expect(vi.mocked(c.connect).mock.calls[0]?.[0]).toBe('192.168.1.7:40000')
  })
})
