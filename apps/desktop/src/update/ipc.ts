import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { UpdateManager } from './manager'

export interface UpdateIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  manager: UpdateManager
}

const CHANNELS = [
  'ccm:update-state',
  'ccm:update-check',
  'ccm:update-download',
  'ccm:update-cancel',
  'ccm:update-install',
  'ccm:update-skip',
  'ccm:update-auto',
  'ccm:update-page',
  'ccm:update-reveal',
]

/** The page only names actions; URLs, files and versions all come from the manager's own state. */
export function registerUpdateIpc(deps: UpdateIpcDeps): () => void {
  const { ipcMain, isAppFrame, manager } = deps
  const gate =
    <A extends unknown[]>(fn: (...args: A) => unknown) =>
    (event: IpcMainInvokeEvent, ...args: A): unknown =>
      isAppFrame(event) ? fn(...args) : null

  ipcMain.handle('ccm:update-state', gate(() => manager.state()))
  ipcMain.handle('ccm:update-check', gate(() => manager.check()))
  ipcMain.handle('ccm:update-download', gate(() => manager.download()))
  ipcMain.handle('ccm:update-cancel', gate(() => manager.cancel()))
  ipcMain.handle('ccm:update-install', gate(() => manager.install()))
  ipcMain.handle('ccm:update-skip', gate((version: unknown) => manager.skip(version)))
  ipcMain.handle('ccm:update-auto', gate((on: unknown) => (typeof on === 'boolean' ? manager.setAutoCheck(on) : manager.state())))
  ipcMain.handle('ccm:update-page', gate(() => manager.openPage()))
  ipcMain.handle('ccm:update-reveal', gate(() => manager.revealFile()))

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
