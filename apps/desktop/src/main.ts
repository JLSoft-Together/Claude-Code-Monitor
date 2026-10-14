import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, screen, session, shell, Tray, type Rectangle, type WebContents } from 'electron'
import { defaultDataDir } from '../../collector/src/datadir'
import { HEX_COLOR, isZoomAction, nextZoom, parseLook, readAppearance, writeAppearance, zoomPercent, type Appearance } from './appearance'
import { createAttention, type Attention } from './attention'
import { installBridge, type BridgeInstall } from './bridge'
import { maskLog } from './log-mask'
import { CollectorHost, FatalError, type FatalReason } from './collector-host'
import { adoptLoginShellPath, offerMoveToApplications, setMacMenu } from './mac'
import { errorPage, loadingPage, RETRY_URL } from './pages'
import { pickStartDir } from './pick-start'
import { hardenWebviews, PREVIEW_PARTITION, registerPreviewIpc, type PreviewIpc } from './preview/ipc'
import { PreviewServer } from './preview/server'
import { RootWatcher } from './preview/watch'
import { GrantStore, GRANTS_FILE } from './preview/grants'
import { LayoutStore, LAYOUTS_FILE, registerLayoutsIpc } from './layouts'
import { registerExtensionsIpc } from './extensions/ipc'
import { createAndroidRunner } from './run/android/runner'
import { createAdbDevices } from './run/android/devices'
import { createCustomRunner } from './run/custom'
import { createFlutterDevices } from './run/flutter/devices'
import { createFlutterRunner } from './run/flutter/runner'
import { registerRunIpc } from './run/ipc'
import type { LayoutIpc } from './layout/ipc'
import { wireLayout } from './layout/wire'
import { afterRunTarget } from './layout/model'
import { defaultSpawner } from './run/proc'
import { RunManager } from './run/sessions'
import { PtySupervisor } from './pty/supervisor'
import { claudeSettingsFile, plannedStatusLine, readStatusLine, writeStatusLine } from './statusline'
import { stringsFor, type Strings } from './strings'

const APP_ID = 'dev.ccm.monitor'
const LEGACY_EXE = 'Claude Code Monitor.exe'
const IS_MAC = process.platform === 'darwin'
const PORT = Number.parseInt(process.env.CCM_PORT ?? '', 10) || 4317
const ORIGIN = `http://127.0.0.1:${PORT}`
const DEV_URL = app.isPackaged ? null : devUrlOf(process.argv)
const PAGE_ORIGIN = DEV_URL?.origin ?? ORIGIN
const START_HIDDEN = process.argv.includes('--hidden')
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE
// The collector refuses requests without it, so the dashboard opens only in this app's windows.
const APP_KEY = randomBytes(32).toString('hex')
// Windows toast buttons open this instead of a browser tab.
const LINK_SCHEME = 'agent-monitor'
// clipboard-read: embedded terminals check for an image before forwarding Ctrl+V (Claude Code pastes it itself).
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen'])

const REPO = path.resolve(__dirname, '..', '..', '..')
const resource = (packaged: string, dev: string): string =>
  app.isPackaged ? path.join(process.resourcesPath, packaged) : path.join(REPO, dev)
const DATA_DIR = process.env.CCM_DATA_DIR || defaultDataDir(process.env, process.platform, os.homedir())

let t: Strings
let host: CollectorHost
let ptys: PtySupervisor | null = null
let attention: Attention | null = null
let mainWindow: BrowserWindow | null = null
let compactWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let sessionEnding = false
const QUIT_DEADLINE_MS = 8_000
const RUN_STOP_GRACE_MS = 4_000
let showingError = false
let hiddenNoticeShown = false
const preview = new PreviewServer()
const previewWatch = new RootWatcher()
let previewIpc: PreviewIpc | null = null
let disposeLayouts: (() => void) | null = null
let disposeExtensions: (() => void) | null = null
let runManager: RunManager | null = null
let disposeRun: (() => void) | null = null
let layoutIpc: LayoutIpc | null = null
let bridge: BridgeInstall | null = null
const claudeSettings = (): string => claudeSettingsFile(process.env, os.homedir())
const ROOTS_TTL_MS = 2_000
let rootsCache: { at: number; dirs: string[] } | null = null

function devUrlOf(argv: readonly string[]): URL | null {
  const raw = argv.find((a) => a.startsWith('--dev-url='))?.slice('--dev-url='.length)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost') ? url : null
  } catch {
    return null
  }
}

const isAppUrl = (url: string): boolean => {
  try {
    const origin = new URL(url).origin
    return origin === ORIGIN || origin === PAGE_ORIGIN
  } catch {
    return false
  }
}

/** Gate for every privileged ccm:* handler: top-level app frame, and the collector on the port is ours. */
const isAppFrame = (event: Electron.IpcMainInvokeEvent): boolean => {
  const frame = event.senderFrame
  return !!frame && !frame.parent && isAppUrl(frame.url) && !!host?.ownsPort
}

/** Preview roots = start + current (after `cd`) folders of live embedded terminals; a census timeout keeps the last answer. */
async function paneRoots(fresh = false): Promise<string[]> {
  if (!fresh && rootsCache && Date.now() - rootsCache.at < ROOTS_TTL_MS) return rootsCache.dirs
  const census = ptys ? await ptys.census() : []
  if (census) rootsCache = { at: Date.now(), dirs: [...new Set(census.flatMap((s) => (s.liveCwd ? [s.cwd, s.liveCwd] : [s.cwd])))] }
  return rootsCache?.dirs ?? []
}

/** Graceful app.stop / force-stop first; whatever is still alive after the grace period is tree-killed. */
async function stopRuns(): Promise<void> {
  const manager = runManager
  if (!manager) return
  await Promise.race([manager.stopAll(), new Promise((r) => setTimeout(r, RUN_STOP_GRACE_MS))])
  manager.killAll()
}

interface RunTrustPlan {
  name: string
  cwd: string
  command: string
  beforeLaunch: string[]
  envKeys: string[]
}

function runTrustPlan(detail: string | undefined): RunTrustPlan | null {
  try {
    const raw = JSON.parse(detail ?? '') as Partial<RunTrustPlan>
    const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    if (typeof raw.name !== 'string' || typeof raw.cwd !== 'string' || typeof raw.command !== 'string') return null
    return { name: raw.name, cwd: raw.cwd, command: raw.command, beforeLaunch: strs(raw.beforeLaunch), envKeys: strs(raw.envKeys) }
  } catch {
    return null
  }
}

function stopPreview(): Promise<void> {
  previewIpc?.dispose()
  previewIpc = null
  disposeLayouts?.()
  disposeLayouts = null
  disposeExtensions?.()
  disposeExtensions = null
  disposeRun?.()
  disposeRun = null
  previewWatch.closeAll()
  const layout = layoutIpc
  layoutIpc = null
  layout?.dispose()
  return Promise.all([preview.close(), layout?.stop()]).then(() => undefined)
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
  contents.on('did-finish-load', () => {
    if (isAppUrl(contents.getURL())) contents.setZoomLevel(saved().zoom ?? 0)
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
    // Alt+Ctrl/⌘ +/-/0 is the page's own code-size shortcut.
    else if (mod && !input.alt && (key === '=' || key === '+')) zoom(contents, 'in')
    else if (mod && !input.alt && key === '-') zoom(contents, 'out')
    else if (mod && !input.alt && key === '0') zoom(contents, 'reset')
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

// Theme colours + zoom picked in the page, so a new window / the startup screen do not flash the OS-default grey.
const appearanceFile = (): string => path.join(app.getPath('userData'), 'appearance.json')
let appearance: Appearance | undefined

function saved(): Appearance {
  appearance ??= readAppearance(appearanceFile())
  return appearance
}

const savedBackground = (): string | null => saved().look?.canvas ?? saved().background ?? null

function saveAppearance(patch: Partial<Appearance>): void {
  appearance = { ...saved(), ...patch }
  writeAppearance(appearanceFile(), appearance)
}

function setWindowBackground(color: string): void {
  if (color === saved().background) return
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(color)
  saveAppearance({ background: color })
}

// Chromium zoom is per origin and not kept across runs: every app page gets the saved level on load.
function zoom(contents: WebContents, action: 'in' | 'out' | 'reset'): number {
  const level = nextZoom(saved().zoom ?? 0, action)
  if (level !== (saved().zoom ?? 0)) saveAppearance({ zoom: level })
  contents.setZoomLevel(level)
  return zoomPercent(level)
}

function baseWindow(options: Electron.BrowserWindowConstructorOptions, prefs: Electron.WebPreferences = {}): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    // macOS takes the window icon from the app bundle.
    icon: IS_MAC ? undefined : resource('ccm.ico', 'scripts/assets/ccm.ico'),
    backgroundColor: savedBackground() ?? (nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ececee'),
    autoHideMenuBar: true,
    title: t.appName,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, preload: path.join(__dirname, 'preload.cjs'), ...prefs },
    ...options,
  })
  win.removeMenu()
  harden(win.webContents)
  return win
}

function createMainWindow(): BrowserWindow {
  const saved = loadBounds()
  const win = baseWindow({ width: saved?.width ?? 1360, height: saved?.height ?? 860, x: saved?.x, y: saved?.y, minWidth: 420, minHeight: 480 }, { webviewTag: true })
  hardenWebviews(win.webContents, { previewSession: session.fromPartition(PREVIEW_PARTITION), openExternal, mac: IS_MAC })
  if (saved?.maximized) win.maximize()
  win.once('ready-to-show', () => {
    if (!START_HIDDEN) win.show()
  })
  win.on('page-title-updated', (_event, title) => tray?.setToolTip(title))
  // Logoff/shutdown closes windows without before-quit; hide-on-close must not block it.
  win.on('session-end', () => {
    quitting = true
    sessionEnding = true
    void host.stop()
    void ptys?.stop()
    void stopPreview()
  })
  win.on('close', (event) => {
    saveBounds(win)
    if (quitting) return
    event.preventDefault()
    win.hide()
    if (!hiddenNoticeShown && tray && !IS_MAC) {
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

// macOS registers the bundle itself (no path/args), so a login start there shows the window.
const loginOptions = (): Electron.Settings => (IS_MAC ? {} : { path: PORTABLE_EXE ?? process.execPath, args: ['--hidden'] })

// The exe name follows productName: a login entry made before the rename to Agent Monitor (same registry value
// name = APP_ID, same install folder on update) still points at the removed old exe.
function repairLoginItem(): void {
  if (IS_MAC || !app.isPackaged || PORTABLE_EXE) return
  const legacy = { path: path.join(path.dirname(process.execPath), LEGACY_EXE), args: ['--hidden'] }
  if (app.getLoginItemSettings(legacy).openAtLogin) app.setLoginItemSettings({ ...loginOptions(), openAtLogin: true })
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: t.trayOpen, click: showMain },
    { label: t.trayCompact, click: () => openAppWindow(`${PAGE_ORIGIN}/?mode=compact`) },
    { type: 'separator' },
    {
      label: IS_MAC ? t.trayLoginMac : t.trayLogin,
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
  // A "Template" name makes macOS tint the menu bar icon for light/dark; @2x is picked up next to it.
  tray = new Tray(IS_MAC ? resource('ccmTrayTemplate.png', 'scripts/assets/ccmTrayTemplate.png') : resource('ccm.ico', 'scripts/assets/ccm.ico'))
  tray.setToolTip(t.appName)
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', showMain)
}

function fatalMessage(reason: FatalReason): string {
  if (reason.kind === 'timeout') return t.collectorTimeout
  if (reason.kind === 'port-in-use') return t.portInUse(PORT)
  return t.collectorExited(reason.code)
}

function showError(reason: FatalReason): void {
  if (!mainWindow || quitting || showingError) return
  showingError = true
  mainWindow.loadURL(errorPage(t, fatalMessage(reason), host.tail, saved().look)).catch(() => undefined)
  showMain()
}

/** Quitting kills every embedded terminal (and the agents in them), so name them before asking. */
async function confirmQuit(): Promise<boolean> {
  const census = ptys ? await ptys.census() : []
  const runs = runManager?.live() ?? []
  if (census?.length === 0 && runs.length === 0) return true
  // null = host did not answer in time: still ask, without the list, rather than kill silently.
  const live = census ?? []
  const home = os.homedir()
  const underHome = (p: string): boolean => {
    const rel = path.relative(home, p)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }
  const short = (p: string): string => (underHome(p) ? path.join('~', path.relative(home, p)) : p)
  const lines = live.map((s) => `• ${s.preset} — ${short(s.cwd)}`)
  const runLines = runs.map((s) => `• ${s.configName}${s.deviceName ? ` → ${s.deviceName}` : ''} — ${short(s.cwd)}`)
  if (mainWindow && !mainWindow.isVisible()) showMain()
  const terms = census?.length !== 0
  const detail = [terms ? (lines.length ? `${t.quitDetail}\n${lines.join('\n')}` : t.quitDetail) : '', runLines.length ? `${t.quitRuns}\n${runLines.join('\n')}` : '']
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    message: terms ? t.quitTitle(live.length) : t.quitRunsTitle(runs.length),
    detail: detail.filter(Boolean).join('\n\n'),
    buttons: [t.quitConfirm, t.quitCancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const { response } = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts)
  return response === 0
}

let booting: Promise<void> | null = null

/** Vite starts alongside the app; give it time before the first load (a miss is a blank page, Ctrl+R retries). */
async function waitForDevServer(url: URL): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(1_000) }).then((r) => r.ok, () => false)
    if (ok) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

function boot(): Promise<void> {
  booting ??= (async () => {
    if (!mainWindow) return
    showingError = false
    try {
      await mainWindow.loadURL(loadingPage(t, saved().look, app.getVersion())).catch(() => undefined)
      await host.start()
      if (DEV_URL) await waitForDevServer(DEV_URL)
      if (!showingError) await mainWindow.loadURL(`${PAGE_ORIGIN}/`)
    } catch (err) {
      showError(err instanceof FatalError ? err.reason : { kind: 'exited', code: null })
    }
  })().finally(() => (booting = null))
  return booting
}

function collectorEnv(): NodeJS.ProcessEnv {
  const portable = PORTABLE_EXE !== undefined
  bridge = installBridge(resource('bridge/statusline-bridge.mjs', 'scripts/statusline-bridge.mjs'), DATA_DIR, process.execPath, portable || !app.isPackaged)
  return {
    ...process.env,
    CCM_PORT: String(PORT),
    CCM_DATA_DIR: DATA_DIR,
    CCM_WEB_DIST: resource('web', 'apps/web/dist'),
    CCM_STATUSLINE_BRIDGE: bridge.script,
    CCM_STATUSLINE_COMMAND: bridge.command,
    CCM_APP_KEY: APP_KEY,
    ...(DEV_URL ? { CCM_DEV_ORIGIN_PORT: DEV_URL.port || '80' } : {}),
    ...(IS_MAC ? { CCM_TOAST_BACKEND: 'electron' } : { CCM_TOAST_LINK: `${LINK_SCHEME}://` }),
  }
}

const LOG_FILES = ['collector.log', 'pty.log', 'layout.log']
const LOG_TAIL_BYTES = 256 * 1024

function tailOf(file: string): string {
  try {
    const buf = readFileSync(file)
    return buf.subarray(Math.max(0, buf.length - LOG_TAIL_BYTES)).toString('utf8')
  } catch {
    return '(missing)'
  }
}

/** Everything a bug report needs in one paste; long opaque strings (tokens, keys) are masked. */
function logReport(pageReport: string): string {
  const head = [
    `${t.appName} ${app.getVersion()}${app.isPackaged ? (PORTABLE_EXE ? ' portable' : '') : ' dev'}`,
    `Electron ${process.versions.electron}, ${process.platform} ${os.release()} ${process.arch}, locale ${app.getLocale()}`,
    `collector port ${PORT}: ${host?.ownsPort ? 'running' : 'not running'}`,
    `generated ${new Date().toISOString()}`,
  ]
  const sections = [head.join('\n'), pageReport && `## Diagnostics\n${pageReport}`]
  for (const name of LOG_FILES) sections.push(`## ${name}\n${tailOf(path.join(app.getPath('logs'), name)).trimEnd()}`)
  return maskLog(sections.filter(Boolean).join('\n\n'), os.homedir(), process.platform) + '\n'
}

function sendAppKey(): void {
  const urls = [`${ORIGIN}/*`, `ws://127.0.0.1:${PORT}/*`]
  // Vite proxies /ws to the collector and passes the header on.
  if (DEV_URL) urls.push(`${DEV_URL.origin}/*`, `ws://${DEV_URL.host}/*`)
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) =>
    callback({ requestHeaders: { ...details.requestHeaders, 'X-CCM-App': APP_KEY } }),
  )
}

const collectorFetch = (route: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${ORIGIN}${route}`, { ...init, headers: { ...init.headers, 'x-ccm-app': APP_KEY }, signal: AbortSignal.timeout(5_000) })

/** Asks the page whether one of its panes runs this session; it then shows that pane itself. */
function paneHandles(terminalId: string): Promise<boolean> {
  const contents = mainWindow?.webContents
  if (!contents || showingError) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), 1_500)
    const onReply = (event: Electron.IpcMainEvent, handled: unknown): void => {
      if (event.sender === contents) done(handled === true)
    }
    const done = (handled: boolean): void => {
      clearTimeout(timer)
      ipcMain.removeListener('ccm:focus-reply', onReply)
      resolve(handled)
    }
    ipcMain.on('ccm:focus-reply', onReply)
    contents.send('ccm:focus', terminalId)
  })
}

/** agent-monitor://focus?k=&t= and agent-monitor://snooze?k=&t=&m= from toast buttons (key checked by the collector). */
async function openLink(raw: string): Promise<void> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return
  }
  if (url.protocol !== `${LINK_SCHEME}:` || !host?.ownsPort) return
  const k = url.searchParams.get('k') ?? ''
  const terminalId = url.searchParams.get('t')
  if (url.hostname === 'snooze') {
    await collectorFetch(`/snooze?${url.searchParams}`).catch(() => undefined)
    return
  }
  // Every real toast link carries the key; a keyless one can only come from another app.
  if (url.hostname !== 'focus' || !k) return
  if (!terminalId) return showMain()
  if (await paneHandles(terminalId)) return showMain()
  const result = await collectorFetch('/focus', { method: 'POST', body: JSON.stringify({ t: terminalId, k }) })
    .then((r) => r.json() as Promise<{ result?: string }>)
    .catch(() => ({ result: 'failed' }))
  if (result.result === 'ok') return
  showMain()
  mainWindow?.webContents.send('ccm:select', terminalId)
}

const linkIn = (argv: readonly string[]): string | undefined => argv.find((a) => a.startsWith(`${LINK_SCHEME}://`))

function registerLinks(): void {
  if (IS_MAC || !app.isPackaged) return
  app.setAsDefaultProtocolClient(LINK_SCHEME, PORTABLE_EXE ?? process.execPath, [])
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
  if (IS_MAC) {
    setMacMenu()
    if (await offerMoveToApplications(t)) return
    adoptLoginShellPath()
  }
  if (IS_MAC && app.dock) {
    attention = createAttention(app.dock)
    app.on('browser-window-focus', () => attention?.settle())
  }
  lockPermissions()
  sendAppKey()
  registerLinks()
  for (const dir of [DATA_DIR, app.getPath('logs')]) if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  host = new CollectorHost({
    script: path.join(__dirname, 'collector.cjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`),
    port: PORT,
    env: collectorEnv(),
    logFile: path.join(app.getPath('logs'), 'collector.log'),
    onFatal: showError,
    onMessage: (data) => attention?.handle(data),
    onExit: () => attention?.clear(),
  })
  const unpacked = (file: string): string => path.join(__dirname, file).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  ptys = new PtySupervisor({
    script: unpacked('pty-host.cjs'),
    nodePty: resource('pty/node_modules/@lydell/node-pty', 'node_modules/@lydell/node-pty'),
    origins: [...new Set([ORIGIN, PAGE_ORIGIN])],
    logFile: path.join(app.getPath('logs'), 'pty.log'),
    shellInitDir: path.join(DATA_DIR, 'shell-init'),
  })
  // The token is the only gate on a shell; hand it out to top-level app frames only.
  // Any other process that grabbed the port serves its own page: no shell for it.
  ipcMain.handle('ccm:pty-endpoint', (event) => (isAppFrame(event) ? (ptys?.endpoint() ?? null) : null))
  ipcMain.handle('ccm:window-bg', (event, color: unknown) => {
    if (!isAppFrame(event) || typeof color !== 'string' || !HEX_COLOR.test(color)) return false
    setWindowBackground(color)
    return true
  })
  ipcMain.handle('ccm:appearance', (event, raw: unknown) => {
    const look = isAppFrame(event) ? parseLook(raw) : null
    if (!look) return false
    if (JSON.stringify(look) !== JSON.stringify(saved().look)) {
      for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(look.canvas)
      saveAppearance({ look, background: look.canvas })
    }
    return true
  })
  ipcMain.handle('ccm:zoom', (event, action: unknown) => {
    if (!isAppFrame(event)) return null
    if (action === 'get') return zoomPercent(saved().zoom ?? 0)
    return isZoomAction(action) ? zoom(event.sender, action) : null
  })
  ipcMain.handle('ccm:statusline-state', (event) => (isAppFrame(event) ? readStatusLine(claudeSettings()).state : null))
  // The page only asks; the native confirm shows the exact change and is the consent.
  ipcMain.handle('ccm:statusline-enable', async (event) => {
    if (!isAppFrame(event) || !bridge) return 'failed'
    const command = bridge.command
    const file = claudeSettings()
    const read = readStatusLine(file)
    if (read.state === 'ours' || read.state === 'unreadable') return read.state
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.MessageBoxOptions = {
      type: 'question',
      message: t.statusLineTitle,
      detail: t.statusLineDetail(file, JSON.stringify({ statusLine: plannedStatusLine(read, command) }, null, 2), read.state === 'other'),
      buttons: [t.statusLineConfirm, t.statusLineCancel],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (response !== 0) return 'cancelled'
    // Re-read: the file may have changed while the dialog was open.
    return writeStatusLine(file, readStatusLine(file), command)
  })
  // Native picker so a folder for a terminal comes from the user, not from page script.
  // Quick setup: a whole projects folder (e.g. D:\Code) readable by the browser / file tabs, picked natively.
  ipcMain.handle('ccm:grant-folder', async (event) => {
    if (!isAppFrame(event)) return null
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = { title: t.grantTitle, properties: ['openDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const folder = res.canceled ? null : (res.filePaths[0] ?? null)
    // A whole drive / filesystem root is never granted.
    if (!folder || path.dirname(folder) === folder) return null
    previewIpc?.grant(folder)
    return folder
  })
  ipcMain.handle('ccm:pick-folder', async (event, near: unknown) => {
    if (!isAppFrame(event)) return null
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath: pickStartDir(near) }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const folder = res.canceled ? null : (res.filePaths[0] ?? null)
    // Readable before its terminal shows up in the census.
    if (folder) previewIpc?.grant(folder)
    return folder
  })
  await preview.start()
  previewIpc = registerPreviewIpc({
    ipcMain,
    isAppFrame,
    server: preview,
    watcher: previewWatch,
    shell,
    dialog,
    getWindow: () => mainWindow,
    getRoots: paneRoots,
    grants: new GrantStore(path.join(DATA_DIR, GRANTS_FILE)),
    confirmAccess: async (folder) => {
      const opts: Electron.MessageBoxOptions = {
        type: 'question',
        message: t.accessTitle(folder),
        detail: t.accessDetail,
        buttons: [t.accessAllow, t.accessDeny],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }
      const { response } = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts)
      return response === 0
    },
  })
  disposeLayouts = registerLayoutsIpc({ ipcMain, isAppFrame, store: new LayoutStore(path.join(DATA_DIR, LAYOUTS_FILE)) })
  runManager = new RunManager({
    dataDir: DATA_DIR,
    env: process.env,
    platform: process.platform,
    home: os.homedir(),
    spawn: defaultSpawner,
    runners: { flutter: createFlutterRunner, android: createAndroidRunner, custom: createCustomRunner },
    devices: {
      flutter: (settings) => createFlutterDevices({ settings, env: process.env, platform: process.platform, home: os.homedir(), spawn: defaultSpawner }),
      adb: (settings) => createAdbDevices({ settings, env: process.env, platform: process.platform, home: os.homedir(), spawn: defaultSpawner }),
    },
    broadcast: (event) => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send('ccm:run-event', event)
    },
    confirm: async (code, detail) => {
      let opts: Electron.MessageBoxOptions
      if (code === 'reinstall') {
        opts = {
          type: 'warning',
          message: t.runReinstallTitle,
          detail: t.runReinstallDetail(detail ?? ''),
          buttons: [t.runReinstallConfirm, t.quitCancel],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }
      } else if (code === 'trust-config') {
        const plan = runTrustPlan(detail)
        if (!plan) return false
        opts = {
          type: 'warning',
          message: t.runTrustTitle(plan.name),
          detail: t.runTrustDetail(plan.cwd, plan.command, plan.beforeLaunch, plan.envKeys),
          buttons: [t.runTrustConfirm, t.quitCancel],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }
      } else return false
      const { response } = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts)
      return response === 0
    },
  })
  await runManager.loadSettings()
  const previewGate = previewIpc
  disposeRun = registerRunIpc({ ipcMain, isAppFrame, manager: runManager, resolveDir: (dir) => previewGate.resolveDir(dir) })
  layoutIpc = wireLayout({
    ipcMain,
    isAppFrame,
    resolveDir: (p) => previewGate.resolveDir(p),
    dataDir: DATA_DIR,
    getJdk: () => runManager?.getSettings().jdk ?? null,
    getRunSettings: () => runManager?.getSettings() ?? { androidSdk: null, jdk: null },
    initScript: resource('layout-daemon/ccm-project-model.gradle', 'apps/layout-daemon/init/ccm-project-model.gradle'),
    server: preview,
    daemonJar: resource('layout-daemon/layout-daemon.jar', 'apps/layout-daemon/build/libs/layout-daemon.jar'),
    logFile: path.join(app.getPath('logs'), 'layout.log'),
    locale: app.getLocale(),
    // Dev reuses the Gradle-staged bundle instead of the 170 MB download; CCM_LAYOUTLIB_DIR= (empty) tests the download flow.
    layoutlibOverride: app.isPackaged ? null : (process.env.CCM_LAYOUTLIB_DIR ?? path.join(REPO, 'apps/layout-daemon/build/layoutlib-dist')),
  })
  // Owner decision: the Gradle project-model task runs after a successful Android build, never on project open.
  // Flutter goes reloading → running on every hot reload; the native build only happened before the first one.
  const modelRefreshed = new Set<string>()
  const offModel = runManager.onSessionState((session, cfg, device) => {
    if (session.state !== 'running' || modelRefreshed.has(session.id)) return
    const target = afterRunTarget(cfg, device)
    if (!target) return
    if (modelRefreshed.size >= 100) modelRefreshed.delete(modelRefreshed.values().next().value!)
    modelRefreshed.add(session.id)
    layoutIpc?.model?.afterBuild(target.root, target.module, target.variant)
  })
  const disposeRunIpc = disposeRun
  disposeRun = () => {
    offModel()
    disposeRunIpc?.()
  }
  // Extensions tab: the page picks a catalog entry; the native confirm shows the exact claude command and is the consent.
  disposeExtensions = registerExtensionsIpc({
    ipcMain,
    isAppFrame,
    confirm: async (event, plan) => {
      const where = plan.scope === 'user' ? t.extWhereUser : plan.scope === 'project' && plan.dir ? t.extWhereProject(plan.dir) : plan.scope === 'local' && plan.dir ? t.extWhereLocal(plan.dir) : t.extWhereNone
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts: Electron.MessageBoxOptions = {
        type: 'question',
        message: t.extTitle(plan.kind),
        detail: t.extDetail(where, plan.commands),
        buttons: [t.extConfirm, t.extCancel],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      return response === 0
    },
  })
  ipcMain.handle('ccm:logs', async (event, action: unknown, pageReport: unknown) => {
    const frame = event.senderFrame
    if (!frame || frame.parent || !isAppUrl(frame.url) || (action !== 'copy' && action !== 'save')) return null
    const text = logReport(typeof pageReport === 'string' ? pageReport.slice(0, 20_000) : '')
    if (action === 'copy') {
      clipboard.writeText(text)
      return { ok: true }
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    const opts: Electron.SaveDialogOptions = {
      defaultPath: path.join(app.getPath('downloads'), `agent-monitor-log-${stamp}.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false }
    try {
      writeFileSync(res.filePath, text)
    } catch {
      return { ok: false }
    }
    shell.showItemInFolder(res.filePath)
    return { ok: true, path: res.filePath }
  })
  repairLoginItem()
  createTray()
  mainWindow = createMainWindow()
  await boot()
  const first = linkIn(process.argv)
  if (first) void openLink(first)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
  app.on('second-instance', (_event, argv) => {
    const link = linkIn(argv)
    if (link) void openLink(link)
    else showMain()
  })
  app.on('activate', showMain)
  app.on('web-contents-created', (_event, contents) => {
    // Only the dashboard window hosts <webview>; hardenWebviews vets partition and src there.
    contents.on('will-attach-webview', (event) => {
      if (contents !== mainWindow?.webContents) event.preventDefault()
    })
  })
  app.on('window-all-closed', () => {
    // Closing windows only hides the dashboard; quitting goes through the tray.
  })
  let stopped = false
  let stopping: Promise<void> | null = null
  let confirming = false
  app.on('before-quit', (event) => {
    // sessionEnding: logoff/shutdown already stopped everything; a modal here would block Windows.
    if (stopped || sessionEnding || !host) {
      quitting = true
      // No graceful path here: gradle / flutter / adb children must not outlive the app.
      if (!stopped) {
        runManager?.killAll()
        layoutIpc?.killNow()
      }
      return
    }
    event.preventDefault()
    if (stopping || confirming) return
    confirming = true
    void confirmQuit()
      .catch(() => true)
      .then((ok) => {
        if (!ok) return
        quitting = true
        attention?.clear()
        // A hung child must never leave the app unquittable.
        const hardExit = setTimeout(() => app.exit(0), QUIT_DEADLINE_MS)
        stopping = Promise.allSettled([host.stop(), ptys?.stop(), stopPreview(), stopRuns()]).then(() => {
          clearTimeout(hardExit)
          stopped = true
          app.quit()
        })
      })
      .finally(() => (confirming = false))
  })
  app
    .whenReady()
    .then(ready)
    .catch((err: unknown) => {
      dialog.showErrorBox('Agent Monitor', err instanceof Error ? err.message : String(err))
      app.exit(1)
    })
}
