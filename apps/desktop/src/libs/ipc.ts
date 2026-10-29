import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { LibCheckResult, LibVulnResult } from '@ccm/shared'
import type { LibChecker } from './checker'

export interface LibsIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  checker: LibChecker
}

export function registerLibsIpc({ ipcMain, isAppFrame, checker }: LibsIpcDeps): () => void {
  ipcMain.handle('ccm:libs-check', async (event, req: unknown): Promise<LibCheckResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'unavailable' }
    const r = (req ?? {}) as { queries?: unknown; fresh?: unknown }
    return checker.check(r.queries, r.fresh === true)
  })
  ipcMain.handle('ccm:libs-vulns', async (event, req: unknown): Promise<LibVulnResult> => {
    if (!isAppFrame(event)) return { ok: false, error: 'unavailable' }
    const r = (req ?? {}) as { queries?: unknown; fresh?: unknown }
    return checker.vulns(r.queries, r.fresh === true)
  })
  return () => {
    ipcMain.removeHandler('ccm:libs-check')
    ipcMain.removeHandler('ccm:libs-vulns')
  }
}
