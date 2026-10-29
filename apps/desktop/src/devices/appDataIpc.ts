import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AppDataFailure } from '@ccm/shared'
import { isDataFileName, type AppDataInspector } from './appData'
import { cleanPrefEdit } from './prefs'
import { isPackage } from './uiToggles'

export interface AppDataIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  inspector: Pick<AppDataInspector, 'list' | 'openDb' | 'rows' | 'query' | 'close' | 'readPrefs' | 'writePref' | 'restorePrefs'>
}

const CHANNELS = [
  'ccm:appdata-list', 'ccm:appdata-db-open', 'ccm:appdata-db-rows', 'ccm:appdata-db-query', 'ccm:appdata-db-close',
  'ccm:appdata-prefs-read', 'ccm:appdata-prefs-write', 'ccm:appdata-prefs-restore',
]

const DENIED: AppDataFailure = { ok: false, error: 'denied' }
const INVALID: AppDataFailure = { ok: false, error: 'invalid' }
const isId = (v: unknown): v is string => typeof v === 'string' && /^(?!-)[A-Za-z0-9_.:@%[\]-]{1,128}$/.test(v)
const isHandle = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)
const isTable = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 512
const isPage = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000
const isPrefsName = (v: unknown): v is string => isDataFileName(v) && v.endsWith('.xml')

export function registerAppDataIpc(deps: AppDataIpcDeps): () => void {
  const { ipcMain, isAppFrame, inspector } = deps
  const target = (event: IpcMainInvokeEvent, id: unknown, pkg: unknown): AppDataFailure | null =>
    !isAppFrame(event) ? DENIED : isId(id) && isPackage(pkg) ? null : INVALID

  ipcMain.handle('ccm:appdata-list', (event, id: unknown, pkg: unknown) => target(event, id, pkg) ?? inspector.list(id as string, pkg as string))
  ipcMain.handle('ccm:appdata-db-open', (event, id: unknown, pkg: unknown, name: unknown) => {
    const bad = target(event, id, pkg) ?? (isDataFileName(name) ? null : INVALID)
    return bad ?? inspector.openDb(id as string, pkg as string, name as string)
  })
  ipcMain.handle('ccm:appdata-db-rows', (event, handle: unknown, table: unknown, page: unknown) => {
    if (!isAppFrame(event)) return DENIED
    return isHandle(handle) && isTable(table) && isPage(page) ? inspector.rows(handle, table, page) : INVALID
  })
  ipcMain.handle('ccm:appdata-db-query', (event, handle: unknown, sql: unknown) => {
    if (!isAppFrame(event)) return DENIED
    return isHandle(handle) ? inspector.query(handle, sql) : INVALID
  })
  ipcMain.handle('ccm:appdata-db-close', (event, handle: unknown) => {
    if (isAppFrame(event) && isHandle(handle)) inspector.close(handle)
    return true
  })
  ipcMain.handle('ccm:appdata-prefs-read', (event, id: unknown, pkg: unknown, name: unknown) => {
    const bad = target(event, id, pkg) ?? (isPrefsName(name) ? null : INVALID)
    return bad ?? inspector.readPrefs(id as string, pkg as string, name as string)
  })
  ipcMain.handle('ccm:appdata-prefs-write', (event, id: unknown, pkg: unknown, name: unknown, edit: unknown) => {
    const bad = target(event, id, pkg) ?? (isPrefsName(name) ? null : INVALID)
    if (bad) return bad
    const e = cleanPrefEdit(edit)
    return e ? inspector.writePref(id as string, pkg as string, name as string, e) : INVALID
  })
  ipcMain.handle('ccm:appdata-prefs-restore', (event, id: unknown, pkg: unknown, name: unknown) => {
    const bad = target(event, id, pkg) ?? (isPrefsName(name) ? null : INVALID)
    return bad ?? inspector.restorePrefs(id as string, pkg as string, name as string)
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
