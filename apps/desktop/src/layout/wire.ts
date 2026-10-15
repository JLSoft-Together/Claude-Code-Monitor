import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { maskLog } from '../log-mask'
import type { PreviewServer } from '../preview/server'
import { RootWatcher } from '../preview/watch'
import { defaultSpawner, killTree, killTreeSparing, runEnv } from '../run/proc'
import type { DaemonChild } from './daemon'
import { registerLayoutIpc, type LayoutIpc } from './ipc'
import { parseLooseKit, type ProjectLoadPayload } from './projectModel'

export interface WireLayoutDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  resolveDir: (p: unknown) => Promise<string | null>
  dataDir: string
  getJdk: () => string | null
  /** Run settings (Android SDK / JDK) for the Gradle project-model task. */
  getRunSettings: () => { androidSdk: string | null; jdk: string | null }
  /** `ccm-project-model.gradle` (dev: apps/layout-daemon/init, packaged: resources/layout-daemon). */
  initScript: string
  /** Loose kit dir with `kit.json` (dev: apps/layout-daemon/build/loose-kit, packaged: resources/layout-daemon/loose-kit). */
  looseKitDir: string
  server: PreviewServer
  daemonJar: string
  /** `logs/layout.log`; daemon `log` notifications and stderr, masked. */
  logFile: string
  locale: string
  layoutlibOverride?: string | null
}

const STRINGS = {
  en: {
    title: 'Download the Android layout renderer?',
    detail: (mb: number, host: string) =>
      `The XML layout preview needs Google's layoutlib (about ${mb} MB) from ${host}. It is downloaded once over HTTPS, checked against pinned SHA-256 hashes and stored in the app data folder.`,
    ok: 'Download',
    cancel: 'Cancel',
  },
  vi: {
    title: 'Tải bộ dựng layout Android?',
    detail: (mb: number, host: string) =>
      `Xem trước layout XML cần layoutlib của Google (khoảng ${mb} MB) từ ${host}. Tải một lần qua HTTPS, kiểm tra theo SHA-256 cố định và lưu trong thư mục dữ liệu của app.`,
    ok: 'Tải về',
    cancel: 'Huỷ',
  },
}

/** Read once; a missing kit (dev without `gradlew stageLooseKit`) is retried on the next render. */
function looseKitLoader(dir: string, log: (level: string, message: string) => void): () => Promise<ProjectLoadPayload | null> {
  let kit: ProjectLoadPayload | null = null
  return async () => {
    if (kit) return kit
    const text = await readFile(path.join(dir, 'kit.json'), 'utf8').catch(() => null)
    if (text === null) return null
    try {
      kit = parseLooseKit(text, dir)
    } catch (err) {
      log('warn', `loose kit unusable: ${err instanceof Error ? err.message : String(err)}`)
    }
    return kit
  }
}

export function wireLayout(deps: WireLayoutDeps): LayoutIpc {
  const s = deps.locale.toLowerCase().startsWith('vi') ? STRINGS.vi : STRINGS.en
  const home = os.homedir()
  const log = (level: string, message: string): void => {
    const line = `${new Date().toISOString()} [${level}] ${maskLog(message, home, process.platform)}\n`
    appendFile(deps.logFile, line, () => undefined)
  }
  return registerLayoutIpc({
    ipcMain: deps.ipcMain,
    isAppFrame: deps.isAppFrame,
    resolveDir: deps.resolveDir,
    dataDir: deps.dataDir,
    getJdk: deps.getJdk,
    server: deps.server,
    daemonJar: deps.daemonJar,
    layoutlibOverride: deps.layoutlibOverride,
    log,
    model: {
      initScript: deps.initScript,
      looseKit: looseKitLoader(deps.looseKitDir, log),
      platform: process.platform,
      env: process.env,
      home,
      getSettings: deps.getRunSettings,
      spawn: defaultSpawner,
      // Same as Run → Stop: the warm Gradle daemon survives a timeout kill.
      kill: (child, sync) => killTreeSparing(child, /GradleDaemon/, { sync }),
      watchDirs: (dirs, onChange) => {
        const watcher = new RootWatcher((_root, changed) => onChange(changed), { debounceMs: 50 })
        for (const d of dirs) watcher.add(d)
        return () => watcher.closeAll()
      },
    },
    spawn: (java, args, cwd) => {
      const child = spawn(java, args, { cwd, env: runEnv(process.env), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      return child as DaemonChild
    },
    kill: (child) => killTree(child as Parameters<typeof killTree>[0]),
    broadcast: (event) => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send('ccm:layout-event', event)
    },
    confirm: async (event, { bytes, host }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts: Electron.MessageBoxOptions = {
        type: 'question',
        message: s.title,
        detail: s.detail(Math.round(bytes / 1_000_000), host),
        buttons: [s.ok, s.cancel],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      return response === 0
    },
  })
}
