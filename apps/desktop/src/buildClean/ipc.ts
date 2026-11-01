import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { parseBuildClean, parseBuildRoots, type BuildCleanResult, type BuildProject } from '@ccm/shared'
import type { BuildCleanService } from './service'

export interface BuildCleanIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  service: BuildCleanService
}

const CHANNELS = ['ccm:build-scan', 'ccm:build-clean', 'ccm:build-cancel']

export function registerBuildCleanIpc({ ipcMain, isAppFrame, service }: BuildCleanIpcDeps): () => void {
  ipcMain.handle('ccm:build-scan', (event, raw: unknown): Promise<BuildProject[] | null> | null => {
    const roots = isAppFrame(event) ? parseBuildRoots(raw) : null
    return roots ? service.scan(roots) : null
  })
  ipcMain.handle('ccm:build-clean', (event, raw: unknown): Promise<BuildCleanResult> | BuildCleanResult => {
    const req = isAppFrame(event) ? parseBuildClean(raw) : null
    return req ? service.clean(req) : { ok: false, error: 'invalid' }
  })
  ipcMain.handle('ccm:build-cancel', (event): boolean => (isAppFrame(event) ? service.cancel() : false))
  return () => {
    for (const c of CHANNELS) ipcMain.removeHandler(c)
  }
}
