import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { PerfFailure } from '@ccm/shared'
import { deviceLabel, type PerfService } from './perf'
import { isPackage } from './uiToggles'

export interface PerfIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  perf: Pick<PerfService, 'history' | 'clear' | 'reset' | 'measure' | 'coldStart'>
}

const CHANNELS = ['ccm:perf-history', 'ccm:perf-clear', 'ccm:perf-reset', 'ccm:perf-measure', 'ccm:perf-cold']
const DENIED: PerfFailure = { ok: false, error: 'denied' }
const INVALID: PerfFailure = { ok: false, error: 'invalid' }
const isId = (v: unknown): v is string => typeof v === 'string' && /^(?!-)[A-Za-z0-9_.:@%[\]-]{1,128}$/.test(v)

export function registerPerfIpc(deps: PerfIpcDeps): () => void {
  const { ipcMain, isAppFrame, perf } = deps
  const target = (event: IpcMainInvokeEvent, id: unknown, pkg: unknown): PerfFailure | null =>
    !isAppFrame(event) ? DENIED : isId(id) && isPackage(pkg) ? null : INVALID

  ipcMain.handle('ccm:perf-history', (event, pkg: unknown) => (!isAppFrame(event) ? DENIED : isPackage(pkg) ? perf.history(pkg) : INVALID))
  ipcMain.handle('ccm:perf-clear', (event, pkg: unknown) => (!isAppFrame(event) ? DENIED : isPackage(pkg) ? perf.clear(pkg) : INVALID))
  ipcMain.handle('ccm:perf-reset', (event, id: unknown, pkg: unknown) => target(event, id, pkg) ?? perf.reset(id as string, pkg as string))
  ipcMain.handle('ccm:perf-measure', (event, id: unknown, pkg: unknown, device: unknown) => target(event, id, pkg) ?? perf.measure(id as string, pkg as string, deviceLabel(device)))
  ipcMain.handle('ccm:perf-cold', (event, id: unknown, pkg: unknown, device: unknown) => target(event, id, pkg) ?? perf.coldStart(id as string, pkg as string, deviceLabel(device)))

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
