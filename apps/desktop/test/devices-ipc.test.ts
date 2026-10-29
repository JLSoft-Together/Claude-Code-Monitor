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
    screencap: vi.fn(async () => ok),
    uiDump: vi.fn(async () => ok),
    uiRead: vi.fn(async () => ok),
    uiApply: vi.fn(async () => ok),
    uiRestore: vi.fn(async () => ok),
    launch: vi.fn(async () => ok),
  }
  const sender = Object.assign(new EventEmitter(), { id: 7 })
  const event = { sender } as unknown as IpcMainInvokeEvent
  const resolveDir = vi.fn(async (dir: unknown) => (dir === '/allowed' ? '/allowed' : null))
  const dispose = registerDevicesIpc({ ipcMain, isAppFrame: () => app, manager: manager as unknown as DeviceManager, resolveDir })
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
    expect(await call('ccm:dev-pair', '1.2.3.4:37000', '12345')).toEqual(DENIED)
    expect(await call('ccm:dev-disconnect', ['a'])).toEqual([])
    expect(await call('ccm:dev-connect-many', ['a'])).toEqual([])
    expect(await call('ccm:dev-to-wifi', 'a')).toEqual(DENIED)
    expect(await call('ccm:dev-remove', ['a'])).toEqual(DENIED)
    expect(await call('ccm:dev-alias', 'a', 'x')).toEqual(DENIED)
    expect(await call('ccm:dev-auto-connect', true)).toEqual(DENIED)
    expect(await call('ccm:dev-discover')).toEqual(DENIED)
    expect(await call('ccm:dev-qr-start')).toEqual(DENIED)
    expect(await call('ccm:dev-qr-cancel', 'q')).toEqual(DENIED)
    expect(await call('ccm:dev-screencap', 'a')).toEqual(DENIED)
    expect(await call('ccm:dev-uidump', 'a')).toEqual(DENIED)
    expect(await call('ccm:dev-ui-read', 'a', null)).toEqual(DENIED)
    expect(await call('ccm:dev-ui-set', 'a', { key: 'night', value: 'yes' }, null)).toEqual(DENIED)
    expect(await call('ccm:dev-ui-restore', 'a', null)).toEqual(DENIED)
    expect(await call('ccm:dev-manifest', '/allowed')).toEqual(DENIED)
    expect(await call('ccm:dev-launch', 'a', { kind: 'activity', pkg: 'com.app', activity: '.Main' })).toEqual(DENIED)
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

  it('screencap / uidump take a plain serial only', async () => {
    const { handlers, manager, event } = setup()
    await handlers.get('ccm:dev-screencap')!(event, 'emulator-5554')
    expect(manager.screencap).toHaveBeenCalledWith('emulator-5554')
    expect(await handlers.get('ccm:dev-uidump')!(event, '-s; rm')).toEqual(DENIED)
    expect(await handlers.get('ccm:dev-screencap')!(event, 42)).toEqual(DENIED)
    expect(manager.uiDump).not.toHaveBeenCalled()
  })

  it('display test and launch values are checked before main runs anything', async () => {
    const { handlers, manager, event } = setup()
    const call = (ch: string, ...a: unknown[]) => handlers.get(ch)!(event, ...a)
    await call('ccm:dev-ui-set', 'a', { key: 'fontScale', value: 1.3 }, 'com.app')
    expect(manager.uiApply).toHaveBeenCalledWith('a', { key: 'fontScale', value: 1.3 }, 'com.app')
    expect(await call('ccm:dev-ui-set', 'a', { key: 'fontScale', value: '1; reboot' }, null)).toEqual({ ok: false, error: 'invalid' })
    expect(await call('ccm:dev-ui-read', 'a', 'not a pkg')).toEqual(DENIED)
    await call('ccm:dev-ui-restore', 'a', undefined)
    expect(manager.uiRestore).toHaveBeenCalledWith('a', null)
    expect(await call('ccm:dev-launch', 'a', { kind: 'uri', uri: 'x://a\nb', pkg: null })).toEqual({ ok: false, error: 'invalid' })
    await call('ccm:dev-launch', 'a', { kind: 'uri', uri: "myapp://it'em", pkg: 'com.app' })
    expect(manager.launch).toHaveBeenCalledWith('a', { kind: 'uri', uri: "myapp://it'em", pkg: 'com.app' })
    expect(await call('ccm:dev-manifest', '/elsewhere')).toEqual(DENIED)
    expect(await call('ccm:dev-manifest', '/allowed')).toEqual({ ok: false, error: 'no-manifest' })
  })

  it('validates input', async () => {
    const { handlers, manager, event } = setup()
    const call = (ch: string, ...a: unknown[]) => handlers.get(ch)!(event, ...a)
    expect(await call('ccm:dev-pair', '1.2.3.4:37000', '12345')).toEqual({ ok: false, error: 'invalid' })
    expect(await call('ccm:dev-pair', '1.2.3.4:37000', '12a456')).toEqual({ ok: false, error: 'invalid' })
    expect(await call('ccm:dev-pair', '1.2.3.4:37000', 123456)).toEqual({ ok: false, error: 'invalid' })
    expect(await call('ccm:dev-pair', '', '123456')).toEqual(DENIED)
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
    expect(handlers.size).toBe(20)
    dispose()
    expect(handlers.size).toBe(0)
  })
})
