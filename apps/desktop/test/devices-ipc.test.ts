import { EventEmitter } from 'node:events'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerDevicesIpc } from '../src/devices/ipc'
import type { DeviceManager } from '../src/devices/manager'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function setup(app = true) {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (ch: string, fn: Handler) => void handlers.set(ch, fn),
    removeHandler: (ch: string) => void handlers.delete(ch),
  } as unknown as IpcMain
  const ok = { ok: true }
  const manager = {
    snapshot: vi.fn(async () => ({ devices: [] })),
    hold: vi.fn(async () => undefined),
    releaseOwner: vi.fn(),
    connect: vi.fn(async () => ok),
    pair: vi.fn(async () => ok),
    disconnect: vi.fn(async () => []),
    connectMany: vi.fn(async () => []),
    toWifi: vi.fn(async () => ok),
    remove: vi.fn(async () => ok),
    setAlias: vi.fn(() => ok),
    setAutoConnect: vi.fn(() => ok),
    discover: vi.fn(async () => []),
    qrStart: vi.fn(async () => ({ id: 'q', payload: 'p' })),
    qrCancel: vi.fn(() => ok),
  }
  const sender = Object.assign(new EventEmitter(), { id: 7 })
  const event = { sender } as unknown as IpcMainInvokeEvent
  const dispose = registerDevicesIpc({ ipcMain, isAppFrame: () => app, manager: manager as unknown as DeviceManager })
  return { handlers, manager, sender, event, dispose }
}

const DENIED = { ok: false, error: 'denied' }
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`)

describe('devices ipc', () => {
  it('denies non-app frames', async () => {
    const { handlers, manager, event } = setup(false)
    const call = (ch: string, ...a: unknown[]) => handlers.get(ch)!(event, ...a)
    expect(await call('ccm:dev-snapshot')).toBeNull()
    expect(await call('ccm:dev-hold', true)).toBe(false)
    expect(await call('ccm:dev-connect', '1.2.3.4:5555')).toEqual(DENIED)
    expect(await call('ccm:dev-pair', '1.2.3.4:37000', '123456')).toEqual(DENIED)
    expect(await call('ccm:dev-disconnect', ['a'])).toEqual([])
    expect(await call('ccm:dev-connect-many', ['a'])).toEqual([])
    expect(await call('ccm:dev-to-wifi', 'a')).toEqual(DENIED)
    expect(await call('ccm:dev-remove', ['a'])).toEqual(DENIED)
    expect(await call('ccm:dev-alias', 'a', 'x')).toEqual(DENIED)
    expect(await call('ccm:dev-auto-connect', true)).toEqual(DENIED)
    expect(await call('ccm:dev-discover')).toEqual(DENIED)
    expect(await call('ccm:dev-qr-start')).toEqual(DENIED)
    expect(await call('ccm:dev-qr-cancel', 'q')).toEqual(DENIED)
    for (const fn of Object.values(manager)) expect(fn).not.toHaveBeenCalled()
  })

  it('forwards valid calls', async () => {
    const { handlers, manager, event } = setup()
    expect(await handlers.get('ccm:dev-hold')!(event, true)).toBe(true)
    expect(manager.hold).toHaveBeenCalledWith('7:view', true)
    await handlers.get('ccm:dev-qr-start')!(event)
    expect(manager.qrStart).toHaveBeenCalledWith('7:qr')
    await handlers.get('ccm:dev-alias')!(event, 'a', '  Pixel ')
    expect(manager.setAlias).toHaveBeenCalledWith('a', 'Pixel')
    await handlers.get('ccm:dev-disconnect')!(event, ids(50))
    expect(manager.disconnect).toHaveBeenCalled()
  })

  it('validates input', async () => {
    const { handlers, manager, event } = setup()
    const call = (ch: string, ...a: unknown[]) => handlers.get(ch)!(event, ...a)
    expect(await call('ccm:dev-pair', '1.2.3.4:37000', '12345')).toEqual(DENIED)
    expect(await call('ccm:dev-disconnect', ids(51))).toEqual([])
    expect(await call('ccm:dev-connect-many', [])).toEqual([])
    expect(await call('ccm:dev-alias', 'a', 'x'.repeat(65))).toEqual(DENIED)
    expect(await call('ccm:dev-to-wifi', '-s')).toEqual(DENIED)
    expect(await call('ccm:dev-remove', ['ok', '-x'])).toEqual(DENIED)
    expect(await call('ccm:dev-connect', '')).toEqual(DENIED)
    expect(await call('ccm:dev-auto-connect', 'yes')).toEqual(DENIED)
    expect(await call('ccm:dev-hold', 'yes')).toBe(false)
    expect(manager.pair).not.toHaveBeenCalled()
    expect(manager.disconnect).not.toHaveBeenCalled()
    expect(manager.toWifi).not.toHaveBeenCalled()
    expect(manager.setAlias).not.toHaveBeenCalled()
  })

  it('releases holds and QR sessions when the sender is destroyed', async () => {
    const { handlers, manager, sender, event } = setup()
    await handlers.get('ccm:dev-hold')!(event, true)
    sender.emit('destroyed')
    expect(manager.releaseOwner).toHaveBeenCalledWith('7:')
  })

  it('releases on main-frame navigation only', async () => {
    const { handlers, manager, sender, event } = setup()
    await handlers.get('ccm:dev-hold')!(event, true)
    sender.emit('did-start-navigation', {}, 'u', true, true)
    sender.emit('did-start-navigation', {}, 'u', false, false)
    expect(manager.releaseOwner).not.toHaveBeenCalled()
    sender.emit('did-start-navigation', {}, 'u', false, true)
    expect(manager.releaseOwner).toHaveBeenCalledWith('7:')
  })

  it('dispose removes every handler', () => {
    const { handlers, dispose } = setup()
    expect(handlers.size).toBe(13)
    dispose()
    expect(handlers.size).toBe(0)
  })
})
