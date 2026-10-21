import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AdbDevice, DevEvent } from '@ccm/shared'

const api = vi.hoisted(() => ({
  handler: null as null | ((e: DevEvent) => void),
  onDevEvent: vi.fn(),
  devHold: vi.fn(),
  devSnapshot: vi.fn(),
  devConnect: vi.fn(),
  devPair: vi.fn(),
  devQrStart: vi.fn(),
  devQrCancel: vi.fn(),
  devDiscover: vi.fn(),
  devDisconnect: vi.fn(),
  devConnectMany: vi.fn(),
}))

vi.mock('../lib/devices', () => ({
  hasDevices: true,
  onDevEvent: (h: (e: DevEvent) => void) => {
    api.handler = h
    api.onDevEvent()
    return () => {}
  },
  devHold: (on: boolean) => api.devHold(on),
  devSnapshot: () => api.devSnapshot(),
  devConnect: (a: string) => api.devConnect(a),
  devPair: (a: string, c: string) => api.devPair(a, c),
  devQrStart: () => api.devQrStart(),
  devQrCancel: (id: string) => api.devQrCancel(id),
  devDiscover: () => api.devDiscover(),
  devDisconnect: (ids: string[]) => api.devDisconnect(ids),
  devConnectMany: (ids: string[]) => api.devConnectMany(ids),
}))

import { useDevicesStore } from './devices'

const dev = (id: string, over: Partial<AdbDevice> = {}): AdbDevice => ({
  id, state: 'ready', transport: 'usb', model: null, product: null, device: null, transportId: null,
  alias: null, name: id, online: true, lastSeen: null, ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  api.handler = null
  for (const f of [api.onDevEvent, api.devHold, api.devSnapshot, api.devConnect, api.devPair, api.devQrStart, api.devQrCancel, api.devDiscover, api.devDisconnect, api.devConnectMany]) f.mockReset()
  api.devHold.mockResolvedValue(true)
  api.devQrCancel.mockResolvedValue({ ok: true })
})

describe('devices store', () => {
  it('open holds and loads the snapshot', async () => {
    api.devSnapshot.mockResolvedValue({ adb: '/adb', devices: [dev('a')], autoConnect: false })
    const s = useDevicesStore()
    await s.open()
    await s.open()
    expect(api.devHold).toHaveBeenCalledWith(true)
    expect(api.onDevEvent).toHaveBeenCalledTimes(1)
    expect(s.devices.map((d) => d.id)).toEqual(['a'])
    expect(s.autoConnect).toBe(false)
    expect(s.loaded).toBe(true)
  })

  it('devices event replaces the list and prunes selection', async () => {
    api.devSnapshot.mockResolvedValue({ adb: '/adb', devices: [dev('a'), dev('b')], autoConnect: true })
    const s = useDevicesStore()
    await s.open()
    s.selectAll(true)
    api.handler!({ type: 'devices', devices: [dev('b')] })
    expect(s.devices.map((d) => d.id)).toEqual(['b'])
    expect([...s.selected]).toEqual(['b'])
  })

  it('busy clears after a failing connect and lastError is set', async () => {
    api.devConnect.mockResolvedValue({ ok: false, error: 'connect-failed', detail: 'x' })
    const s = useDevicesStore()
    const p = s.connect('1.2.3.4:5555')
    expect(s.busy.has('connect')).toBe(true)
    await p
    expect(s.busy.size).toBe(0)
    expect(s.lastError).toEqual({ code: 'connect-failed', detail: 'x' })
  })

  it('pair resolves the bridge result', async () => {
    api.devPair.mockResolvedValue({ ok: true, detail: 'paired' })
    const s = useDevicesStore()
    await expect(s.pair('1.2.3.4:37000', '123456')).resolves.toEqual({ ok: true, detail: 'paired' })
    expect(api.devPair).toHaveBeenCalledWith('1.2.3.4:37000', '123456')
    expect(s.busy.size).toBe(0)
  })

  it('cancelled results never set lastError', async () => {
    api.devConnect.mockResolvedValue({ ok: false, error: 'cancelled' })
    const s = useDevicesStore()
    await s.connect('1.2.3.4:5555')
    expect(s.lastError).toBeNull()
  })

  it('discover handles both result shapes', async () => {
    const s = useDevicesStore()
    api.devDiscover.mockResolvedValue({ ok: false, error: 'mdns-unavailable' })
    await s.discover()
    expect(s.lastError?.code).toBe('mdns-unavailable')
    api.devDiscover.mockResolvedValue([{ id: 'a', result: { ok: false, error: 'timeout' } }])
    await s.discover()
    expect(s.lastError?.code).toBe('timeout')
  })

  it('qr events update only the matching session', async () => {
    api.devQrStart.mockResolvedValue({ id: 'q1', payload: 'WIFI:T:ADB;S:n;P:1;;' })
    api.devSnapshot.mockResolvedValue(null)
    const s = useDevicesStore()
    await s.open()
    await s.startQr()
    expect(s.qr).toMatchObject({ id: 'q1', status: 'waiting' })
    api.handler!({ type: 'qr', id: 'other', status: 'failed' })
    expect(s.qr?.status).toBe('waiting')
    api.handler!({ type: 'qr', id: 'q1', status: 'pairing' })
    expect(s.qr?.status).toBe('pairing')
    await s.cancelQr()
    expect(api.devQrCancel).toHaveBeenCalledWith('q1')
    expect(s.qr).toBeNull()
  })

  it('batch errors skip cancelled and keep the first real failure', async () => {
    const s = useDevicesStore()
    const mixed = [
      { id: 'a', result: { ok: false, error: 'cancelled' } },
      { id: 'b', result: { ok: false, error: 'timeout' } },
    ]
    api.devDisconnect.mockResolvedValue(mixed)
    await s.disconnect(['a', 'b'])
    expect(s.lastError?.code).toBe('timeout')
    s.lastError = null
    api.devConnectMany.mockResolvedValue(mixed.slice(0, 1))
    await s.connectMany(['a'])
    expect(s.lastError).toBeNull()
    api.devConnectMany.mockResolvedValue(mixed)
    await s.connectMany(['a', 'b'])
    expect((s.lastError as { code: string } | null)?.code).toBe('timeout')
  })

  it('close cancels a running qr', async () => {
    api.devQrStart.mockResolvedValue({ id: 'q1', payload: 'p' })
    api.devSnapshot.mockResolvedValue(null)
    const s = useDevicesStore()
    await s.open()
    await s.startQr()
    await s.close()
    expect(api.devHold).toHaveBeenLastCalledWith(false)
    expect(api.devQrCancel).toHaveBeenCalledWith('q1')
    expect(s.qr).toBeNull()
  })

  it('close during a pending startQr cancels the late session', async () => {
    let resolve!: (v: unknown) => void
    api.devQrStart.mockReturnValue(new Promise((r) => (resolve = r)))
    api.devSnapshot.mockResolvedValue(null)
    const s = useDevicesStore()
    await s.open()
    const p = s.startQr()
    await s.close()
    resolve({ id: 'late', payload: 'p' })
    await p
    expect(api.devQrCancel).toHaveBeenCalledWith('late')
    expect(s.qr).toBeNull()
  })

  it('close still cancels qr when devHold(false) rejects', async () => {
    api.devQrStart.mockResolvedValue({ id: 'q1', payload: 'p' })
    api.devSnapshot.mockResolvedValue(null)
    const s = useDevicesStore()
    await s.open()
    await s.startQr()
    api.devHold.mockRejectedValue(new Error('x'))
    await expect(s.close()).rejects.toThrow('x')
    expect(api.devQrCancel).toHaveBeenCalledWith('q1')
  })

  it('startQr cancels a session that is already running', async () => {
    api.devQrStart.mockResolvedValueOnce({ id: 'q1', payload: 'p' }).mockResolvedValueOnce({ id: 'q2', payload: 'p' })
    api.devSnapshot.mockResolvedValue(null)
    const s = useDevicesStore()
    await s.open()
    await s.startQr()
    await s.startQr()
    expect(api.devQrCancel).toHaveBeenCalledWith('q1')
    expect(s.qr?.id).toBe('q2')
  })

  it('selection getters gate batch actions', async () => {
    api.devSnapshot.mockResolvedValue({
      adb: '/adb',
      devices: [dev('w', { transport: 'wifi' }), dev('u', { online: false })],
      autoConnect: true,
    })
    const s = useDevicesStore()
    await s.open()
    s.toggle('w')
    s.toggle('u')
    expect(s.selectedOnlineWifi.length).toBe(1)
    expect(s.selectedOffline.length).toBe(1)
    expect(s.selectedOfflineWifi.length).toBe(0)
  })
})
