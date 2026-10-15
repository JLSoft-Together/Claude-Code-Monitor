import { watch as fsWatch } from 'node:fs'
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
  getSettings: () => { flutterSdk: string | null; flutterSdkProjects?: Record<string, string> }
}

export interface FlutterPreviewWire {
  service: FlutterPreviewService
  dispose: () => void
}

const SAVE_DEBOUNCE_MS = 400

/** Non-recursive: the project root also holds build/ and .dart_tool/, which churn during a run. */
function watchPubspec(root: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | null = null
  let watcher: ReturnType<typeof fsWatch>
  try {
    watcher = fsWatch(root, { recursive: false }, (_event, file) => {
      if (file?.toString() !== 'pubspec.yaml') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, SAVE_DEBOUNCE_MS)
    })
  } catch {
    return () => undefined
  }
  watcher.on('error', () => watcher.close())
  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}

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
    watchPubspec: (root, onChange) => watchPubspec(root, onChange),
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
