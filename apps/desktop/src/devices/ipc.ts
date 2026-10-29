import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { DevResult } from '@ccm/shared'
import { readProjectManifest } from './manifest'
import type { DeviceManager } from './manager'
import { cleanChange, cleanLaunch, isPackage } from './uiToggles'

export interface DevicesIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  manager: DeviceManager
  /** Same folder gate as the Explorer (`PreviewIpc.resolveDir`), for the project manifest. */
  resolveDir: (dir: unknown) => Promise<string | null>
}

const CHANNELS = [
  'ccm:dev-snapshot', 'ccm:dev-hold', 'ccm:dev-connect', 'ccm:dev-pair', 'ccm:dev-disconnect', 'ccm:dev-connect-many', 'ccm:dev-to-wifi',
  'ccm:dev-remove', 'ccm:dev-alias', 'ccm:dev-auto-connect', 'ccm:dev-discover', 'ccm:dev-qr-start', 'ccm:dev-qr-cancel',
  'ccm:dev-screencap', 'ccm:dev-uidump', 'ccm:dev-ui-read', 'ccm:dev-ui-set', 'ccm:dev-ui-restore', 'ccm:dev-manifest', 'ccm:dev-launch',
]

const DENIED: DevResult = { ok: false, error: 'denied' }
const INVALID: DevResult = { ok: false, error: 'invalid' }
const isId = (v: unknown): v is string => typeof v === 'string' && /^(?!-)[A-Za-z0-9_.:@%[\]-]{1,128}$/.test(v)
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every(isId)
const pkgOf = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : isPackage(v) ? v : undefined)
const isAddress = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 300

export function registerDevicesIpc(deps: DevicesIpcDeps): () => void {
  const { ipcMain, isAppFrame, manager, resolveDir } = deps

  const tracked = new Set<number>()
  // A window that reloads / closes drops its holds and QR sessions, so the tracker can stop.
  const ownerOf = (event: IpcMainInvokeEvent, key: string): string => {
    const id = event.sender.id
    if (!tracked.has(id)) {
      tracked.add(id)
      event.sender.once('destroyed', () => {
        tracked.delete(id)
        manager.releaseOwner(`${id}:`)
      })
      event.sender.on('did-start-navigation', (_e, _url, inPlace, isMainFrame) => {
        if (isMainFrame && !inPlace) manager.releaseOwner(`${id}:`)
      })
    }
    return `${id}:${key}`
  }

  ipcMain.handle('ccm:dev-snapshot', (event) => (isAppFrame(event) ? manager.snapshot().catch(() => null) : null))
  ipcMain.handle('ccm:dev-hold', async (event, on: unknown) => {
    if (!isAppFrame(event) || typeof on !== 'boolean') return false
    await manager.hold(ownerOf(event, 'view'), on)
    return true
  })
  ipcMain.handle('ccm:dev-connect', (event, address: unknown) => (isAppFrame(event) && isAddress(address) ? manager.connect(address) : DENIED))
  ipcMain.handle('ccm:dev-pair', (event, address: unknown, code: unknown) => {
    if (!isAppFrame(event) || !isAddress(address)) return DENIED
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return INVALID
    return manager.pair(address, code)
  })
  ipcMain.handle('ccm:dev-disconnect', (event, ids: unknown) => (isAppFrame(event) && isIds(ids) ? manager.disconnect(ids) : []))
  ipcMain.handle('ccm:dev-connect-many', (event, ids: unknown) => (isAppFrame(event) && isIds(ids) ? manager.connectMany(ids) : []))
  ipcMain.handle('ccm:dev-to-wifi', (event, id: unknown) => (isAppFrame(event) && isId(id) ? manager.toWifi(id) : DENIED))
  ipcMain.handle('ccm:dev-remove', (event, ids: unknown) => (isAppFrame(event) && isIds(ids) ? manager.remove(ids) : DENIED))
  ipcMain.handle('ccm:dev-alias', (event, id: unknown, alias: unknown) => {
    if (!isAppFrame(event) || !isId(id)) return DENIED
    if (alias !== null && (typeof alias !== 'string' || alias.trim().length > 64)) return DENIED
    return manager.setAlias(id, alias === null ? null : alias.trim())
  })
  ipcMain.handle('ccm:dev-auto-connect', (event, on: unknown) => (isAppFrame(event) && typeof on === 'boolean' ? manager.setAutoConnect(on) : DENIED))
  ipcMain.handle('ccm:dev-discover', (event) => (isAppFrame(event) ? manager.discover() : DENIED))
  ipcMain.handle('ccm:dev-qr-start', (event) => (isAppFrame(event) ? manager.qrStart(ownerOf(event, 'qr')) : DENIED))
  ipcMain.handle('ccm:dev-qr-cancel', (event, id: unknown) => (isAppFrame(event) && isId(id) ? manager.qrCancel(id) : DENIED))
  ipcMain.handle('ccm:dev-screencap', (event, id: unknown) => (isAppFrame(event) && isId(id) ? manager.screencap(id) : DENIED))
  ipcMain.handle('ccm:dev-uidump', (event, id: unknown) => (isAppFrame(event) && isId(id) ? manager.uiDump(id) : DENIED))
  ipcMain.handle('ccm:dev-ui-read', (event, id: unknown, pkg: unknown) => {
    const p = pkgOf(pkg)
    return isAppFrame(event) && isId(id) && p !== undefined ? manager.uiRead(id, p) : DENIED
  })
  ipcMain.handle('ccm:dev-ui-set', (event, id: unknown, change: unknown, pkg: unknown) => {
    if (!isAppFrame(event) || !isId(id)) return DENIED
    const c = cleanChange(change)
    const p = pkgOf(pkg)
    return c && p !== undefined ? manager.uiApply(id, c, p) : INVALID
  })
  ipcMain.handle('ccm:dev-ui-restore', (event, id: unknown, pkg: unknown) => {
    const p = pkgOf(pkg)
    return isAppFrame(event) && isId(id) && p !== undefined ? manager.uiRestore(id, p) : DENIED
  })
  ipcMain.handle('ccm:dev-manifest', async (event, dir: unknown) => {
    if (!isAppFrame(event)) return DENIED
    const root = await resolveDir(dir)
    return root ? readProjectManifest(root) : DENIED
  })
  ipcMain.handle('ccm:dev-launch', (event, id: unknown, target: unknown) => {
    if (!isAppFrame(event) || !isId(id)) return DENIED
    const l = cleanLaunch(target)
    return l ? manager.launch(id, l) : INVALID
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
