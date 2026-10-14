import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { RunResult } from '@ccm/shared'
import type { RunManager } from './sessions'

export interface RunIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  manager: RunManager
  /** Same folder gate as the Explorer (`PreviewIpc.resolveDir`). */
  resolveDir: (dir: unknown) => Promise<string | null>
}

const CHANNELS = [
  'ccm:run-detect', 'ccm:run-env', 'ccm:run-devices', 'ccm:run-emulators', 'ccm:run-launch-emulator', 'ccm:run-configs', 'ccm:run-config-save',
  'ccm:run-config-delete', 'ccm:run-config-import', 'ccm:run-preview', 'ccm:run-start', 'ccm:run-stop', 'ccm:run-reload', 'ccm:run-pub-get',
  'ccm:run-sessions', 'ccm:run-settings', 'ccm:run-settings-set',
]

const DENIED: RunResult = { ok: false, error: { code: 'denied' } }
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:@%-]{1,128}$/.test(v)

export function registerRunIpc(deps: RunIpcDeps): () => void {
  const { ipcMain, isAppFrame, manager, resolveDir } = deps
  const root = async (event: IpcMainInvokeEvent, dir: unknown): Promise<string | null> => (isAppFrame(event) ? resolveDir(dir) : null)
  // A project dir inside an allowed root (config cwd / pubspec dir); must not escape it.
  const inside = async (event: IpcMainInvokeEvent, dir: unknown): Promise<string | null> => {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null
    return root(event, dir)
  }

  ipcMain.handle('ccm:run-detect', async (event, dir: unknown) => {
    const r = await root(event, dir)
    return r ? manager.detect(r, true).catch(() => null) : null
  })
  ipcMain.handle('ccm:run-env', async (event, dir: unknown, kind: unknown) => {
    const d = await inside(event, dir)
    return d && (kind === 'flutter' || kind === 'android') ? manager.env(d, kind).catch(() => null) : null
  })
  ipcMain.handle('ccm:run-devices', (event) => (isAppFrame(event) ? manager.devices().catch(() => []) : []))
  ipcMain.handle('ccm:run-emulators', (event) => (isAppFrame(event) ? manager.emulators().catch(() => []) : []))
  ipcMain.handle('ccm:run-launch-emulator', (event, id: unknown, source: unknown) => {
    if (!isAppFrame(event) || !isId(id) || (source !== 'flutter' && source !== 'adb')) return DENIED
    return manager.launchEmulator(id, source)
  })
  ipcMain.handle('ccm:run-configs', async (event, dir: unknown) => {
    const r = await root(event, dir)
    return r ? manager.configs(r).catch(() => []) : []
  })
  ipcMain.handle('ccm:run-config-save', async (event, dir: unknown, cfg: unknown) => {
    const r = await root(event, dir)
    return r ? manager.saveConfig(r, cfg).catch(() => null) : null
  })
  ipcMain.handle('ccm:run-config-delete', async (event, dir: unknown, id: unknown) => {
    const r = await root(event, dir)
    return r && isId(id) ? manager.deleteConfig(r, id).catch(() => false) : false
  })
  ipcMain.handle('ccm:run-config-import', async (event, dir: unknown) => {
    const r = await root(event, dir)
    return r ? manager.importConfigs(r).catch(() => []) : []
  })
  ipcMain.handle('ccm:run-preview', async (event, dir: unknown, cfg: unknown, deviceId: unknown) => {
    const r = await root(event, dir)
    return r ? manager.preview(r, cfg, isId(deviceId) ? deviceId : null).catch(() => null) : null
  })
  ipcMain.handle('ccm:run-start', async (event, req: unknown) => {
    const { root: dir, configId, deviceId } = (req ?? {}) as Record<string, unknown>
    const r = await root(event, dir)
    if (!r || !isId(configId)) return DENIED
    return manager.start({ root: r, configId, deviceId: isId(deviceId) ? deviceId : null })
  })
  ipcMain.handle('ccm:run-stop', (event, id: unknown) => (isAppFrame(event) && isId(id) ? manager.stop(id) : DENIED))
  ipcMain.handle('ccm:run-reload', (event, id: unknown, full: unknown) => (isAppFrame(event) && isId(id) ? manager.reload(id, full === true) : DENIED))
  ipcMain.handle('ccm:run-pub-get', async (event, dir: unknown) => {
    const d = await inside(event, dir)
    return d ? manager.pubGet(d) : DENIED
  })
  ipcMain.handle('ccm:run-sessions', (event) => (isAppFrame(event) ? manager.list() : []))
  ipcMain.handle('ccm:run-settings', (event) => (isAppFrame(event) ? manager.getSettings() : null))
  ipcMain.handle('ccm:run-settings-set', (event, next: unknown) => {
    if (!isAppFrame(event) || !next || typeof next !== 'object') return null
    return manager.setSettings(next as Parameters<RunManager['setSettings']>[0]).catch(() => null)
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
