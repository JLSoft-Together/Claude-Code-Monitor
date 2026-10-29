import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import type { BackupApplyResult, BackupExportResult, BackupPreview, BackupSectionId } from '@ccm/shared'
import { cleanSectionIds, exportName, MAX_BACKUP_BYTES, sectionsOf } from './format'
import type { BackupService } from './service'

export interface BackupIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  service: BackupService
  readLocal: (contents: WebContents) => Promise<Record<string, unknown>>
  saveDialog: (event: IpcMainInvokeEvent, defaultPath: string) => Promise<string | null>
  openDialog: (event: IpcMainInvokeEvent) => Promise<string | null>
  confirmApply: (event: IpcMainInvokeEvent, sections: BackupSectionId[]) => Promise<boolean>
  relaunch: () => void
  documentsDir: string
}

const CHANNELS = ['ccm:backup-export', 'ccm:backup-pick', 'ccm:backup-apply', 'ccm:backup-relaunch']

/** Renderer localStorage, read from main so the page never hands over arbitrary data to export. */
export const LOCAL_SNAPSHOT_JS =
  "(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('ccm.')) o[k] = localStorage.getItem(k) } return o })()"

export function registerBackupIpc(deps: BackupIpcDeps): () => void {
  const { ipcMain, isAppFrame, service } = deps

  ipcMain.handle('ccm:backup-export', async (event): Promise<BackupExportResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const backup = service.snapshot(await deps.readLocal(event.sender).catch(() => ({})))
    const file = await deps.saveDialog(event, path.join(deps.documentsDir, exportName(new Date())))
    if (!file) return { ok: false, error: 'cancelled' }
    try {
      await fs.writeFile(file, JSON.stringify(backup, null, 1))
    } catch {
      return { ok: false, error: 'write' }
    }
    return { ok: true, file, sections: sectionsOf(backup) }
  })

  ipcMain.handle('ccm:backup-pick', async (event): Promise<BackupPreview> => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const file = await deps.openDialog(event)
    if (!file) return { ok: false, error: 'cancelled' }
    try {
      if ((await fs.stat(file)).size > MAX_BACKUP_BYTES) return { ok: false, error: 'too-large' }
      return service.preview(await fs.readFile(file, 'utf8'), file)
    } catch {
      return { ok: false, error: 'read' }
    }
  })

  ipcMain.handle('ccm:backup-apply', async (event, token: unknown, ids: unknown): Promise<BackupApplyResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const picked = cleanSectionIds(ids)
    if (typeof token !== 'string' || !picked || !picked.size) return { ok: false, error: 'invalid' }
    if (!service.stagedSections(token)) return { ok: false, error: 'expired' }
    if (!(await deps.confirmApply(event, [...picked]))) return { ok: false, error: 'cancelled' }
    return service.stage(token, picked, await deps.readLocal(event.sender).catch(() => ({})))
  })

  ipcMain.handle('ccm:backup-relaunch', (event) => {
    if (!isAppFrame(event)) return false
    deps.relaunch()
    return true
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
