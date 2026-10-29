import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow, Dialog, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ApkCompareResult, ApkFailure, ApkResult } from '@ccm/shared'
import { isWithin, realOrNull, rootKey } from '../preview/paths'
import { analyzeApk, ApkError, compareSnapshots, isApkName, sideOf, type ApkSnapshot } from './analyze'
import { ApkHistory } from './history'

export interface ApkIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  /** Explorer gate: real path of a file inside an allowed root, else null. */
  resolveFile: (p: unknown) => Promise<string | null>
  resolveDir: (dir: unknown) => Promise<string | null>
  dialog: Pick<Dialog, 'showOpenDialog'>
  getWindow: () => BrowserWindow | null
  dataDir: string
}

const CHANNELS = ['ccm:apk-pick', 'ccm:apk-analyze', 'ccm:apk-compare']
const DENIED: ApkFailure = { ok: false, error: 'denied' }
const INVALID: ApkFailure = { ok: false, error: 'invalid' }
const CACHE_MAX = 4
const PICKED_MAX = 50

const failure = (err: unknown): ApkFailure => ({ ok: false, error: err instanceof ApkError ? err.code : 'read-failed' })

export function registerApkIpc(deps: ApkIpcDeps): () => void {
  const { ipcMain, isAppFrame } = deps
  const history = new ApkHistory(deps.dataDir)
  // Files chosen in the native picker this run: readable even outside every project root.
  const picked = new Set<string>()
  const cache = new Map<string, ApkSnapshot>()

  async function gate(p: unknown): Promise<string | ApkFailure> {
    if (typeof p !== 'string' || p.length > 4096 || !path.isAbsolute(p) || !isApkName(p)) return INVALID
    const real = await realOrNull(p)
    if (!real) return { ok: false, error: 'missing' }
    if (!isApkName(real)) return INVALID
    if (picked.has(rootKey(real))) return real
    return (await deps.resolveFile(real)) ? real : DENIED
  }

  async function snapshot(file: string): Promise<ApkSnapshot> {
    const st = await fs.stat(file).catch(() => null)
    if (!st?.isFile()) throw new ApkError('read-failed')
    const key = `${rootKey(file)}|${st.size}|${st.mtimeMs}`
    const hit = cache.get(key)
    if (hit) {
      cache.delete(key)
      cache.set(key, hit)
      return hit
    }
    const snap = await analyzeApk(file)
    cache.set(key, snap)
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
    return snap
  }

  ipcMain.handle('ccm:apk-pick', async (event, near: unknown) => {
    if (!isAppFrame(event)) return null
    const win = deps.getWindow()
    const dir = typeof near === 'string' && path.isAbsolute(near) ? await deps.resolveDir(near) : null
    const opts: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Android', extensions: ['apk', 'aab'] }], ...(dir ? { defaultPath: dir } : {}) }
    const res = win ? await deps.dialog.showOpenDialog(win, opts) : await deps.dialog.showOpenDialog(opts)
    const file = res.canceled ? undefined : res.filePaths[0]
    if (!file || !isApkName(file)) return null
    const real = await realOrNull(file)
    if (!real) return null
    if (picked.size >= PICKED_MAX) picked.delete(picked.values().next().value!)
    picked.add(rootKey(real))
    return real
  })

  ipcMain.handle('ccm:apk-analyze', async (event, req: unknown): Promise<ApkResult> => {
    if (!isAppFrame(event) || !req || typeof req !== 'object') return DENIED
    const { path: p, root } = req as { path?: unknown; root?: unknown }
    const file = await gate(p)
    if (typeof file !== 'string') return file
    try {
      const snap = await snapshot(file)
      const dir = root === undefined || root === null ? null : await deps.resolveDir(root)
      const project = dir && isWithin(dir, file) ? dir : path.dirname(file)
      const prev = await history.record(project, snap)
      return { ok: true, report: snap.report, previous: prev ? sideOf(prev) : null, diff: prev ? compareSnapshots(prev, snap) : null }
    } catch (err) {
      return failure(err)
    }
  })

  ipcMain.handle('ccm:apk-compare', async (event, req: unknown): Promise<ApkCompareResult> => {
    if (!isAppFrame(event) || !req || typeof req !== 'object') return DENIED
    const { path: p, other: o } = req as { path?: unknown; other?: unknown }
    const [file, other] = await Promise.all([gate(p), gate(o)])
    if (typeof file !== 'string') return file
    if (typeof other !== 'string') return other
    try {
      const [cur, old] = await Promise.all([snapshot(file), snapshot(other)])
      return { ok: true, other: old.report, diff: compareSnapshots(old, cur) }
    } catch (err) {
      return failure(err)
    }
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
