import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { isDiskWarnGb, type DiskState } from '@ccm/shared'
import type { DiskWatch } from './watch'

export interface DiskIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  watch: DiskWatch
  /** Open project folders the page reports; only ever measured, never written. */
  setProjects: (dirs: string[]) => void
  openFolder: (dir: string) => Promise<boolean>
}

const CHANNELS = ['ccm:disk-state', 'ccm:disk-refresh', 'ccm:disk-set', 'ccm:disk-projects', 'ccm:disk-open']
const PROJECTS_MAX = 50

export function registerDiskIpc({ ipcMain, isAppFrame, watch, setProjects, openFolder }: DiskIpcDeps): () => void {
  ipcMain.handle('ccm:disk-state', (event): DiskState | null => (isAppFrame(event) ? watch.state : null))
  ipcMain.handle('ccm:disk-refresh', (event): Promise<DiskState> | null => (isAppFrame(event) ? watch.measure() : null))
  ipcMain.handle('ccm:disk-set', (event, raw: unknown) => {
    const gb = raw && typeof raw === 'object' ? (raw as { warnGb?: unknown }).warnGb : undefined
    return isAppFrame(event) && isDiskWarnGb(gb) ? watch.setWarnGb(gb) : null
  })
  ipcMain.handle('ccm:disk-projects', (event, raw: unknown) => {
    if (!isAppFrame(event) || !Array.isArray(raw)) return false
    setProjects(raw.filter((d): d is string => typeof d === 'string' && d.length > 0 && d.length <= 1024).slice(0, PROJECTS_MAX))
    return true
  })
  // Only a drive Orrery measured: the page cannot open an arbitrary path through this.
  ipcMain.handle('ccm:disk-open', (event, raw: unknown) => {
    const drive = isAppFrame(event) && typeof raw === 'string' ? watch.state.drives.find((d) => d.mount === raw) : undefined
    return drive ? openFolder(drive.mount) : false
  })
  return () => {
    for (const c of CHANNELS) ipcMain.removeHandler(c)
  }
}
