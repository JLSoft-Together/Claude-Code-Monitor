import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { isAwakeMode, type AwakeState, type CaptureShotResult, type CaptureStatus } from '@ccm/shared'
import type { KeepAwake } from '../power/awake'
import { cleanDir, isInside, parsePatch, parseShotRequest, SHOT_SUB } from './files'
import type { CaptureFolder } from './folder'

export interface CaptureIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  folder: CaptureFolder
  /** Native folder dialog; null = cancelled. */
  pickFolder: (event: IpcMainInvokeEvent, near: string | null) => Promise<string | null>
  openFolder: (dir: string) => Promise<boolean>
  awake: KeepAwake
  setAwakeMode: (mode: Parameters<KeepAwake['setMode']>[0]) => void
}

const CHANNELS = ['ccm:capture-get', 'ccm:capture-pick', 'ccm:capture-set', 'ccm:capture-shot', 'ccm:capture-open', 'ccm:awake-state', 'ccm:awake-mode']

export function registerCaptureIpc({ ipcMain, isAppFrame, folder, pickFolder, openFolder, awake, setAwakeMode }: CaptureIpcDeps): () => void {
  ipcMain.handle('ccm:capture-get', (event): CaptureStatus | null => (isAppFrame(event) ? folder.status() : null))
  ipcMain.handle('ccm:capture-pick', async (event): Promise<CaptureStatus | null> => {
    if (!isAppFrame(event)) return null
    const dir = cleanDir(await pickFolder(event, folder.config().dir))
    return dir ? folder.set({ dir }) : folder.status()
  })
  ipcMain.handle('ccm:capture-set', (event, raw: unknown): CaptureStatus | null => {
    const patch = isAppFrame(event) ? parsePatch(raw) : null
    return patch ? folder.set(patch) : null
  })
  ipcMain.handle('ccm:capture-shot', async (event, raw: unknown): Promise<CaptureShotResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'invalid' }
    const req = parseShotRequest(raw)
    if (!req) return { ok: false, error: 'invalid' }
    const dir = folder.active()
    if (!dir) return { ok: false, error: 'no-dir' }
    const file = await folder.writeShot(req.png, req.device, req.frame)
    return file && isInside(path.join(dir, SHOT_SUB), file) ? { ok: true, path: file } : { ok: false, error: 'failed' }
  })
  ipcMain.handle('ccm:capture-open', async (event): Promise<boolean> => {
    const dir = isAppFrame(event) ? folder.active() : null
    return dir ? openFolder(dir) : false
  })
  ipcMain.handle('ccm:awake-state', (event): AwakeState | null => (isAppFrame(event) ? awake.state() : null))
  ipcMain.handle('ccm:awake-mode', (event, mode: unknown): AwakeState | null => {
    if (!isAppFrame(event) || !isAwakeMode(mode)) return null
    setAwakeMode(mode)
    return awake.state()
  })
  return () => {
    for (const c of CHANNELS) ipcMain.removeHandler(c)
  }
}
