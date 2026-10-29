import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { DevFsFailure, DevFsKind, DevFsProgress, DevFsScope } from '@ccm/shared'
import { safeToOpen, validPath } from './devFiles'
import { PUSH_MAX, type DeviceFiles } from './fileBrowser'
import { isPackage } from './uiToggles'

export interface FilesIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  files: Pick<DeviceFiles, 'list' | 'mkdir' | 'remove' | 'pull' | 'push' | 'cancel' | 'wasPulled'>
  /** Same folder gate as the Explorer (`PreviewIpc.resolveDir`): "pull into the project". */
  resolveDir: (dir: unknown) => Promise<string | null>
  pickFolder: (event: IpcMainInvokeEvent) => Promise<string | null>
  pickFiles: (event: IpcMainInvokeEvent) => Promise<string[] | null>
  openLocal: (local: string, mode: 'open' | 'reveal') => Promise<boolean>
}

const CHANNELS = ['ccm:devfs-list', 'ccm:devfs-mkdir', 'ccm:devfs-delete', 'ccm:devfs-pull', 'ccm:devfs-push', 'ccm:devfs-cancel', 'ccm:devfs-open']
const DENIED: DevFsFailure = { ok: false, error: 'denied' }
const INVALID: DevFsFailure = { ok: false, error: 'invalid' }
const isId = (v: unknown): v is string => typeof v === 'string' && /^(?!-)[A-Za-z0-9_.:@%[\]-]{1,128}$/.test(v)
const isTransfer = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)
const KINDS: DevFsKind[] = ['dir', 'file', 'link', 'other']

export function cleanScope(v: unknown): DevFsScope | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  if (s.kind === 'sdcard') return { kind: 'sdcard' }
  return s.kind === 'app' && isPackage(s.pkg) ? { kind: 'app', pkg: s.pkg } : null
}

/** Dropped / picked local files: absolute, no NUL, at most PUSH_MAX; existence and type are checked when pushing. */
export function cleanLocalPaths(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > PUSH_MAX) return null
  const ok = v.every((p) => typeof p === 'string' && p.length <= 4096 && !p.includes('\0') && path.isAbsolute(p))
  return ok ? (v as string[]) : null
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null)

export function registerFilesIpc(deps: FilesIpcDeps): () => void {
  const { ipcMain, isAppFrame, files } = deps
  const progressTo = (event: IpcMainInvokeEvent) => (p: DevFsProgress) => {
    if (!event.sender.isDestroyed()) event.sender.send('ccm:devfs-progress', p)
  }

  ipcMain.handle('ccm:devfs-list', (event, id: unknown, scope: unknown, dir: unknown) => {
    if (!isAppFrame(event)) return DENIED
    const s = cleanScope(scope)
    return isId(id) && s && validPath(s, dir) ? files.list(id, s, dir) : INVALID
  })
  ipcMain.handle('ccm:devfs-mkdir', (event, id: unknown, scope: unknown, dir: unknown, name: unknown) => {
    if (!isAppFrame(event)) return DENIED
    const s = cleanScope(scope)
    return isId(id) && s && validPath(s, dir) && typeof name === 'string' ? files.mkdir(id, s, dir, name) : INVALID
  })
  ipcMain.handle('ccm:devfs-delete', (event, id: unknown, scope: unknown, p: unknown, dir: unknown) => {
    if (!isAppFrame(event)) return DENIED
    const s = cleanScope(scope)
    return isId(id) && s && validPath(s, p) && typeof dir === 'boolean' ? files.remove(id, s, p, dir) : INVALID
  })
  ipcMain.handle('ccm:devfs-pull', async (event, id: unknown, req: unknown) => {
    if (!isAppFrame(event)) return DENIED
    const r = obj(req)
    const s = cleanScope(r?.scope)
    const kind = KINDS.find((k) => k === r?.kind)
    const size = r?.size === null || (typeof r?.size === 'number' && Number.isSafeInteger(r.size) && r.size >= 0) ? (r.size as number | null) : undefined
    const dest = obj(r?.dest)
    if (!r || !isId(id) || !s || !validPath(s, r.path) || !kind || size === undefined || !isTransfer(r.transfer) || !dest) return INVALID
    let dir: string | null
    if (dest.kind === 'pick') {
      dir = await deps.pickFolder(event)
      if (!dir) return { ok: false, error: 'cancelled' }
    } else if (dest.kind === 'dir') {
      dir = await deps.resolveDir(dest.dir)
      if (!dir) return { ok: false, error: 'outside' }
    } else return INVALID
    return files.pull(id, s, r.path, kind, kind === 'link' ? null : size, dir, r.transfer, progressTo(event))
  })
  ipcMain.handle('ccm:devfs-push', async (event, id: unknown, req: unknown) => {
    if (!isAppFrame(event)) return DENIED
    const r = obj(req)
    const s = cleanScope(r?.scope)
    const src = obj(r?.source)
    if (!r || !isId(id) || !s || !validPath(s, r.dir) || !isTransfer(r.transfer) || !src) return INVALID
    let locals: string[] | null
    if (src.kind === 'pick') {
      locals = await deps.pickFiles(event)
      if (!locals?.length) return { ok: false, error: 'cancelled' }
    } else if (src.kind === 'paths') {
      locals = cleanLocalPaths(src.paths)
      if (!locals) return INVALID
    } else return INVALID
    return files.push(id, s, r.dir, locals, r.transfer, progressTo(event))
  })
  ipcMain.handle('ccm:devfs-cancel', (event, transfer: unknown) => isAppFrame(event) && isTransfer(transfer) && files.cancel(transfer))
  ipcMain.handle('ccm:devfs-open', (event, local: unknown, mode: unknown) => {
    if (!isAppFrame(event) || typeof local !== 'string' || (mode !== 'open' && mode !== 'reveal') || !files.wasPulled(local)) return false
    return deps.openLocal(local, mode === 'open' && safeToOpen(path.basename(local)) ? 'open' : 'reveal')
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
