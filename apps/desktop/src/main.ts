import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeTheme, screen, session, shell, Tray, type Rectangle, type WebContents } from 'electron'
import { installBridge } from './bridge'
import { CollectorHost, FatalError, type FatalReason } from './collector-host'
import { errorPage, loadingPage, RETRY_URL } from './pages'
import { stringsFor, type Strings } from './strings'

const APP_ID = 'dev.ccm.monitor'
const PORT = Number.parseInt(process.env.CCM_PORT ?? '', 10) || 4317
const ORIGIN = `http://127.0.0.1:${PORT}`
const START_HIDDEN = process.argv.includes('--hidden')
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen'])

const REPO = path.resolve(__dirname, '..', '..', '..')
const resource = (packaged: string, dev: string): string =>
  app.isPackaged ? path.join(process.resourcesPath, packaged) : path.join(REPO, dev)
const DATA_DIR = process.env.CCM_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'ccm')

let t: Strings
let host: CollectorHost
let mainWindow: BrowserWindow | null = null
let compactWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let showingError = false
let hiddenNoticeShown = false

const isAppUrl = (url: string): boolean => {
  try {
    return new URL(url).origin === ORIGIN
  } catch {
    return false
  }
}

function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

function harden(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) openAppWindow(url)
    else openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (url === RETRY_URL) {
      event.preventDefault()
      void boot()
      return
    }
    if (isAppUrl(url)) return
    event.preventDefault()
    openExternal(url)
  })
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const mod = input.control || input.meta
    if (key === 'f5' || (mod && key === 'r')) {
      if (showingError && contents === mainWindow?.webContents) void boot()
      else contents.reload()
    }
    else if (key === 'f12' || (mod && input.shift && key === 'i')) contents.toggleDevTools()
    else if (mod && (key === '=' || key === '+')) contents.setZoomLevel(contents.getZoomLevel() + 0.5)
    else if (mod && key === '-') contents.setZoomLevel(contents.getZoomLevel() - 0.5)
    else if (mod && key === '0') contents.setZoomLevel(0)
    else return
    event.preventDefault()
  })
}

const boundsFile = (): string => path.join(app.getPath('userData'), 'window.json')

interface SavedBounds extends Rectangle {
  maximized: boolean
}

function loadBounds(): SavedBounds | null {
  try {
    const saved = JSON.parse(readFileSync(boundsFile(), 'utf8')) as SavedBounds
    const area = screen.getDisplayMatching(saved).workArea
    const visible = saved.x < area.x + area.width && saved.x + saved.width > area.x && saved.y < area.y + area.height && saved.y >= area.y - 8
    return visible ? saved : null
  } catch {
    return null
  }
}

function saveBounds(win: BrowserWindow): void {
  try {
    writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
  } catch {
    // Window placement is a convenience; losing it is fine.
  }
}

function baseWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    icon: resource('ccm.ico', 'scripts/assets/ccm.ico'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121211' : '#f4f4f2',
    autoHideMenuBar: true,
    title: t.appName,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    ...options,
  })
  win.removeMenu()
  harden(win.webContents)
  return win
}

function createMainWindow(): BrowserWindow {
  const saved = loadBounds()
  const win = baseWindow({ width: saved?.width ?? 1360, height: saved?.height ?? 860, x: saved?.x, y: saved?.y, minWidth: 420, minHeight: 480 })
  if (saved?.maximized) win.maximize()
  win.once('ready-to-show', () => {
    if (!START_HIDDEN) win.show()
  })
  win.on('page-title-updated', (_event, title) => tray?.setToolTip(title))
  win.on('close', (event) => {
    saveBounds(win)
    if (quitting) return
    event.preventDefault()
    win.hide()
    if (!hiddenNoticeShown && tray) {
      hiddenNoticeShown = true
      tray.displayBalloon({ title: t.appName, content: t.hiddenNotice, iconType: 'info' })
    }
  })
  return win
}

function showMain(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openAppWindow(url: string): void {
  const compact = new URL(url).searchParams.get('mode') === 'compact'
  if (compact && compactWindow) {
    compactWindow.show()
    compactWindow.focus()
    return
  }
  const win = compact ? baseWindow({ width: 440, height: 720, minWidth: 320, minHeight: 360 }) : baseWindow({ width: 1280, height: 820 })
  if (compact) {
    compactWindow = win
    win.on('closed', () => (compactWindow = null))
  }
  win.once('ready-to-show', () => win.show())
  void win.loadURL(url)
}

const loginOptions = (): Electron.Settings => ({ path: PORTABLE_EXE ?? process.execPath, args: ['--hidden'] })

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: t.trayOpen, click: showMain },
    { label: t.trayCompact, click: () => openAppWindow(`${ORIGIN}/?mode=compact`) },
    { label: t.trayBrowser, click: () => void shell.openExternal(`${ORIGIN}/`) },
    { type: 'separator' },
    {
      label: t.trayLogin,
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: app.isPackaged && app.getLoginItemSettings(loginOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginOptions(), openAtLogin: item.checked }),
    },
    { label: t.trayLogs, click: () => void shell.openPath(app.getPath('logs')) },
    { type: 'separator' },
    { label: t.trayQuit, click: () => app.quit() },
  ])
}

function createTray(): void {
  tray = new Tray(resource('ccm.ico', 'scripts/assets/ccm.ico'))
  tray.setToolTip(t.appName)
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', showMain)
}

function fatalMessage(reason: FatalReason): string {
  return reason.kind === 'timeout' ? t.collectorTimeout : t.collectorExited(reason.code)
}

function showError(reason: FatalReason): void {
  if (!mainWindow || quitting || showingError) return
  showingError = true
  mainWindow.loadURL(errorPage(t, fatalMessage(reason), host.tail)).catch(() => undefined)
  showMain()
}

let booting: Promise<void> | null = null

function boot(): Promise<void> {
  booting ??= (async () => {
    if (!mainWindow) return
    showingError = false
    try {
      await mainWindow.loadURL(loadingPage(t)).catch(() => undefined)
      await host.start()
      if (!showingError) await mainWindow.loadURL(`${ORIGIN}/`)
    } catch (err) {
      showError(err instanceof FatalError ? err.reason : { kind: 'exited', code: null })
    }
  })().finally(() => (booting = null))
  return booting
}

function collectorEnv(): NodeJS.ProcessEnv {
  const portable = PORTABLE_EXE !== undefined
  const bridge = installBridge(resource('bridge/statusline-bridge.mjs', 'scripts/statusline-bridge.mjs'), DATA_DIR, process.execPath, portable || !app.isPackaged)
  return {
    ...process.env,
    CCM_PORT: String(PORT),
    CCM_DATA_DIR: DATA_DIR,
    CCM_WEB_DIST: resource('web', 'apps/web/dist'),
    CCM_STATUSLINE_BRIDGE: bridge.script,
    CCM_STATUSLINE_COMMAND: bridge.command,
  }
}

function lockPermissions(): void {
  const allowed = (permission: string, url: string): boolean => ALLOWED_PERMISSIONS.has(permission) && isAppUrl(url)
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(allowed(permission, details.requestingUrl)),
  )
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => allowed(permission, origin))
}

async function ready(): Promise<void> {
  t = stringsFor(app.getLocale())
  lockPermissions()
  for (const dir of [DATA_DIR, app.getPath('logs')]) if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  host = new CollectorHost({
    script: path.join(__dirname, 'collector.cjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`),
    port: PORT,
    env: collectorEnv(),
    logFile: path.join(app.getPath('logs'), 'collector.log'),
    onFatal: showError,
  })
  createTray()
  mainWindow = createMainWindow()
  await boot()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId(APP_ID)
  app.on('second-instance', showMain)
  app.on('window-all-closed', () => {
    // Closing windows only hides the dashboard; quitting goes through the tray.
  })
  let stopped = false
  let stopping: Promise<void> | null = null
  app.on('before-quit', (event) => {
    quitting = true
    if (stopped || !host) return
    event.preventDefault()
    stopping ??= host.stop().finally(() => {
      stopped = true
      app.quit()
    })
  })
  // Logoff/shutdown may close windows without before-quit; hide-on-close must not block it.
  app.on('session-end', () => {
    quitting = true
    void host?.stop()
  })
  app
    .whenReady()
    .then(ready)
    .catch((err: unknown) => {
      dialog.showErrorBox('Claude Code Monitor', err instanceof Error ? err.message : String(err))
      app.exit(1)
    })
}
