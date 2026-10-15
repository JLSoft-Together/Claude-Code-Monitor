import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { FwpResult, FwpScanResult } from '@ccm/shared'
import { readPackage } from './host'
import type { FlutterPreviewService } from './service'

export interface FlutterPreviewIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  /** Explorer gate (`PreviewIpc.resolveDir`): real path of an allowed file / folder, else null. */
  resolveDir: (p: unknown) => Promise<string | null>
  service: FlutterPreviewService
}

const CHANNELS = ['ccm:fwp-scan', 'ccm:fwp-start', 'ccm:fwp-show', 'ccm:fwp-stop', 'ccm:fwp-get']
const MAX_UP = 8
const DENIED: FwpResult = { ok: false, error: { code: 'denied' } }
const NONE: FwpScanResult = { flutter: false, root: null, entries: [] }
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:@%-]{1,128}$/.test(v)
const isFile = async (p: string): Promise<boolean> => !!(await fs.stat(p).catch(() => null))?.isFile()

/** Nearest folder with `pubspec.yaml` from `start` upwards, never leaving the allowed folders. */
export async function findPubspecRoot(start: string, allowed: (p: string) => Promise<string | null>, exists: (file: string) => Promise<boolean> = isFile): Promise<string | null> {
  let dir = (await isFile(start)) ? path.dirname(start) : start
  for (let i = 0; i < MAX_UP; i++) {
    if (await exists(path.join(dir, 'pubspec.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    const real = await allowed(parent)
    if (!real) return null
    dir = real
  }
  return null
}

export function registerFlutterPreviewIpc(deps: FlutterPreviewIpcDeps): () => void {
  const { ipcMain, isAppFrame, resolveDir, service } = deps
  const gate = async (event: IpcMainInvokeEvent, p: unknown): Promise<string | null> => (isAppFrame(event) ? resolveDir(p) : null)

  ipcMain.handle('ccm:fwp-scan', async (event, p: unknown, withEntries: unknown): Promise<FwpScanResult> => {
    const real = await gate(event, p)
    const root = real ? await findPubspecRoot(real, resolveDir) : null
    if (!root) return NONE
    const pubspec = await fs.readFile(path.join(root, 'pubspec.yaml'), 'utf8').catch(() => '')
    if (!readPackage(pubspec)?.flutter) return { flutter: false, root, entries: [] }
    if (withEntries === false) return { flutter: true, root, entries: [] }
    return { flutter: true, root, entries: await service.scan(root).catch(() => []) }
  })
  ipcMain.handle('ccm:fwp-start', async (event, root: unknown, deviceId: unknown, flavor: unknown): Promise<FwpResult> => {
    const r = await gate(event, root)
    if (!r || !isId(deviceId) || (flavor !== undefined && flavor !== null && typeof flavor !== 'string')) return DENIED
    return service.start(r, deviceId, flavor || null)
  })
  ipcMain.handle('ccm:fwp-show', (event, id: unknown): Promise<FwpResult> | FwpResult => {
    if (!isAppFrame(event) || typeof id !== 'string' || !id || id.length > 512) return DENIED
    return service.show(id)
  })
  ipcMain.handle('ccm:fwp-stop', async (event): Promise<FwpResult> => {
    if (!isAppFrame(event)) return DENIED
    await service.stop()
    return { ok: true }
  })
  ipcMain.handle('ccm:fwp-get', (event) => (isAppFrame(event) ? service.get() : null))

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
