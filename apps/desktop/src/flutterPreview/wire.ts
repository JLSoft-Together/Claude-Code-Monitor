import os from 'node:os'
import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { RootWatcher } from '../preview/watch'
import { defaultSpawner } from '../run/proc'
import { registerFlutterPreviewIpc } from './ipc'
import { FlutterPreviewService } from './service'

export interface WireFlutterPreviewDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  resolveDir: (p: unknown) => Promise<string | null>
  getSettings: () => { flutterSdk: string | null }
}

export interface FlutterPreviewWire {
  service: FlutterPreviewService
  dispose: () => void
}

const SAVE_DEBOUNCE_MS = 400

export function wireFlutterPreview(deps: WireFlutterPreviewDeps): FlutterPreviewWire {
  const service = new FlutterPreviewService({
    spawn: defaultSpawner,
    env: process.env,
    platform: process.platform,
    home: os.homedir(),
    settings: deps.getSettings,
    emit: (snapshot) => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send('ccm:fwp-state', snapshot)
    },
    watch: (dir, onChange) => {
      const watcher = new RootWatcher((_root, changed) => onChange(changed), { debounceMs: SAVE_DEBOUNCE_MS })
      watcher.add(dir)
      return () => watcher.closeAll()
    },
  })
  const disposeIpc = registerFlutterPreviewIpc({ ipcMain: deps.ipcMain, isAppFrame: deps.isAppFrame, resolveDir: deps.resolveDir, service })
  return {
    service,
    dispose: () => {
      disposeIpc()
      service.dispose()
    },
  }
}
