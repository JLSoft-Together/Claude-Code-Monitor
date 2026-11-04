import type {
  AvailablePlugin,
  ExtInstallRequest,
  ExtRemoveRequest,
  ExtResult,
  ExtSourceRequest,
  ExtStatus,
  FwpResult,
  FwpScanResult,
  FwpSnapshot,
  McpPageCall,
  McpPageResult,
  McpServerRow,
  PaneOpenRequest,
  PaneOpenResult,
  PtyEndpoint,
  RunCommandPreview,
  RunConfig,
  RunDetectResult,
  RunDevice,
  RunEmulator,
  RunEnv,
  RunEvent,
  RunKind,
  RunResult,
  RunSession,
  RunStartRequest,
  RunTemplates,
  TelegramInbound,
  TelegramInboundResult,
  ToolchainReport,
} from '@ccm/shared'
import type { FileView, PreviewChange, PreviewTarget } from './preview'
import type { BundleStatus, LayoutEvent, LayoutModelInfo, LayoutRenderRequest, LayoutRenderResult, LayoutStatus } from './layoutPreview'

/** Chord pressed inside a browser pane's <webview>, forwarded by the main process (fields of KeyboardEventInit). */
export interface ForwardedKey {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export interface DesktopLook {
  canvas: string
  surface: string
  ink: string
  muted: string
  faint: string
  accent: string
  bar?: string
  dark: boolean
}

/** Run pane SDK / JDK folders; null = auto-detect. */
export interface RunSettings {
  flutterSdk: string | null
  androidSdk: string | null
  jdk: string | null
  /** Per-project Flutter SDK keyed by the resolved project dir (lower-cased on Windows). */
  flutterSdkProjects?: Record<string, string>
  /** XML preview: compile the project in the background when a layout uses views without classes. */
  layoutAutoCompile?: boolean
}

/** The folder settings of `RunSettings` (SDK / JDK paths). */
export type RunSdkKey = 'flutterSdk' | 'androidSdk' | 'jdk'

export type HooksState = 'ours' | 'partial' | 'none' | 'unreadable'

export type StatusLineState = 'ours' | 'other' | 'none' | 'unreadable'

/** Settings › DeepSeek (v81): Codewhale CLI state as main reports it; never carries a key. */
export interface DeepSeekStatus {
  installed: boolean
  needsDownload: boolean
  version: string | null
  loggedIn: boolean | null
  telemetry: boolean | null
  installRoute: 'winget' | 'npm' | 'script' | null
  origin: 'npm' | 'winget' | 'standalone' | null
  /** Fingerprint of Claude rules + MCP names + Orrery templates against the last sync. */
  sync: 'never' | 'current' | 'stale'
  syncedAt: number | null
  busy: 'install' | 'login' | 'logout' | 'telemetry' | 'sync' | 'update' | null
}

export interface DeepSeekUpdateCheck extends DeepSeekResult {
  current?: string
  latest?: string
  newer?: boolean
}

export type DeepSeekCode = 'badInput' | 'busy' | 'cancelled' | 'notInstalled' | 'noInstaller' | 'installed' | 'timeout' | 'failed' | 'notFound'

export interface DeepSeekResult {
  ok: boolean
  code?: DeepSeekCode
  detail?: string
}

export type DeepSeekSyncId = 'agents' | 'config' | 'mcp' | 'skill-handoff' | 'skill-delegate-claude' | 'skill-delegate-codex'

export interface DeepSeekSyncResult extends DeepSeekResult {
  files?: { id: DeepSeekSyncId; file: string; action: 'create' | 'update' | 'unchanged' | 'skip'; reason?: 'notManaged' | 'unreadable' | 'nothingToAdd' }[]
  mcpAdded?: string[]
}

export type DeepSeekEvent = { phase: 'install'; line: string } | { phase: 'download'; mb: number; totalMb: number | null; pct: number | null }

interface DesktopBridge {
  platform: string
  titleBar?: string
  ptyEndpoint: () => Promise<PtyEndpoint | null>
  /** `near`: the last project; the dialog opens in its parent folder. */
  pickFolder: (near?: string) => Promise<string | null>
  /** Theme canvas colour (#RRGGBB) for the native window background, kept for the next launch. */
  setWindowBackground?: (color: string) => Promise<boolean>
  /** Theme colours (#RRGGBB) for the startup screen and new windows. */
  setAppearance?: (look: DesktopLook) => Promise<boolean>
  setLocale?: (locale: 'en' | 'vi') => Promise<boolean>
  /** App zoom (Chromium level, saved by the app); resolves to the new percent. */
  zoomApp?: (action: 'in' | 'out' | 'reset' | 'get') => Promise<number | null>
  /** Start with Windows / open at login: no argument reads, a boolean sets; null in a dev build. */
  loginItem?: (on?: boolean) => Promise<boolean | null>
  /** Claude Code's settings.json statusLine vs the bridge (quick setup). */
  statusLineState?: () => Promise<StatusLineState | null>
  /** Native confirm, then writes the bridge into settings.json. */
  enableStatusLine?: () => Promise<'ok' | 'ours' | 'unreadable' | 'failed' | 'cancelled'>
  /** Hook bridge in settings.json (docs §11y): read, or add / remove after a native confirm. */
  hooksState?: () => Promise<HooksState | null>
  setHooks?: (on: boolean) => Promise<'ok' | 'unreadable' | 'failed' | 'cancelled'>
  /** Native folder picker; the folder becomes readable by browser / file tabs. */
  grantFolder?: () => Promise<string | null>
  logs?: (action: 'copy' | 'save', report: string) => Promise<{ ok: boolean; path?: string } | null>
  onFocus?: (handler: (terminalId: string) => boolean) => void
  onSelect?: (handler: (terminalId: string) => void) => void
  onPaneOpen?: (handler: (req: PaneOpenRequest) => PaneOpenResult | Promise<PaneOpenResult>) => void
  /** v80 MCP tools that need the workspace; the PTY host re-validates whatever the handler answers. */
  onMcpCall?: (handler: (call: McpPageCall) => McpPageResult | Promise<McpPageResult>) => void
  onTelegramInbound?: (handler: (req: TelegramInbound) => TelegramInboundResult | Promise<TelegramInboundResult>) => void
  captureRect?: (rect: { x: number; y: number; width: number; height: number }) => Promise<Uint8Array | null>
  previewUrl?: (path: string) => Promise<PreviewTarget | null>
  readFile?: (path: string) => Promise<FileView | null>
  watch?: (root: string) => Promise<boolean>
  unwatch?: (root: string) => Promise<boolean>
  onPreviewChanged?: (handler: (change: PreviewChange) => void) => () => void
  pickFile?: (kind: 'html' | 'any', near?: string) => Promise<string | null>
  openExternal?: (url: string) => Promise<boolean>
  reveal?: (path: string) => Promise<boolean>
  openPath?: (path: string) => Promise<string>
  /** Native "Allow … to open files in <folder>?"; true when the path is (now) readable. */
  requestAccess?: (path: string) => Promise<boolean>
  onForwardKey?: (handler: (key: ForwardedKey) => void) => () => void
  /** Extensions tab (v28): read-only status; every change asks a native confirm showing the claude command. */
  extStatus?: (dir?: string) => Promise<ExtStatus | null>
  extMcp?: (dir?: string, fresh?: boolean) => Promise<{ servers: McpServerRow[]; at: number } | null>
  extInstall?: (req: ExtInstallRequest) => Promise<ExtResult>
  extRemove?: (req: ExtRemoveRequest) => Promise<ExtResult>
  extSource?: (req: ExtSourceRequest) => Promise<(ExtResult & { marketplace?: string; plugins?: AvailablePlugin[] }) | null>
  extLogin?: (name: string, dir?: string) => Promise<ExtResult>
  /** Main keeps the CLI part for 60 s; `fresh` asks again now. */
  deepseekStatus?: (fresh?: boolean) => Promise<DeepSeekStatus | null>
  /** `codewhale doctor --check-updates` (contacts the release service, changes nothing). */
  deepseekCheckUpdate?: () => Promise<DeepSeekUpdateCheck>
  /** Native confirm with the route's command; progress via onDeepSeek like install. */
  deepseekUpdate?: () => Promise<DeepSeekResult>
  /** Native confirm with the exact command first; progress via onDeepSeek. */
  deepseekInstall?: () => Promise<DeepSeekResult>
  deepseekCancel?: () => Promise<boolean>
  /** The key goes to `codewhale auth set --api-key-stdin` in main and is never sent back. */
  deepseekLogin?: (key: string) => Promise<DeepSeekResult>
  deepseekLogout?: () => Promise<DeepSeekResult>
  deepseekTelemetry?: (on: boolean) => Promise<DeepSeekResult>
  deepseekSync?: () => Promise<DeepSeekSyncResult>
  onDeepSeek?: (handler: (event: DeepSeekEvent) => void) => () => void
  /** Run pane (v31): desktop main detects, spawns and streams; the page only sends ids and config fields. */
  runDetect?: (root: string) => Promise<RunDetectResult | null>
  runEnv?: (dir: string, kind: Exclude<RunKind, 'custom'>) => Promise<RunEnv | null>
  runDevices?: () => Promise<RunDevice[]>
  runEmulators?: () => Promise<RunEmulator[]>
  runLaunchEmulator?: (id: string, source: RunEmulator['source']) => Promise<RunResult>
  runConfigs?: (root: string) => Promise<RunConfig[]>
  runConfigSave?: (root: string, cfg: RunConfig) => Promise<RunConfig | null>
  runConfigDelete?: (root: string, id: string) => Promise<boolean>
  runConfigImport?: (root: string) => Promise<RunConfig[]>
  runPreview?: (root: string, cfg: RunConfig, deviceId: string | null) => Promise<RunCommandPreview>
  runStart?: (req: RunStartRequest) => Promise<RunResult>
  runStop?: (sessionId: string) => Promise<RunResult>
  runReload?: (sessionId: string, full: boolean) => Promise<RunResult>
  runPubGet?: (dir: string) => Promise<RunResult>
  runSessions?: () => Promise<RunSession[]>
  onRunEvent?: (handler: (event: RunEvent) => void) => () => void
  runSettings?: () => Promise<RunSettings | null>
  runSettingsSet?: (patch: Partial<RunSettings>) => Promise<RunSettings | null>
  /** A Run pane shows `root`: main watches its project files and keeps device trackers up while held. */
  runHold?: (root: string, key: string, on: boolean) => Promise<boolean>
  /** Imports IntelliJ / VS Code configs the first time a project's Run pane opens (once per project). */
  runConfigAutoImport?: (root: string) => Promise<RunConfig[]>
  runToolchain?: (dir: string, kind: Exclude<RunKind, 'custom'>) => Promise<ToolchainReport | null>
  runTemplates?: () => Promise<RunTemplates | null>
  runTemplatesSet?: (next: RunTemplates) => Promise<RunTemplates | null>
  runProjectSdkSet?: (dir: string, sdk: string | null) => Promise<RunSettings | null>
  /** XML layout preview (v32): layoutlib bundle / JDK / render daemon state. */
  layoutStatus?: () => Promise<LayoutStatus | null>
  /** Native consent first; resolves when the bundle is ready / failed, progress via onLayoutEvent. */
  layoutDownload?: () => Promise<BundleStatus | { state: 'cancelled' } | null>
  /** Main reads the file (res/layout* only) and renders it; the PNG comes back as a preview-server URL. */
  layoutRender?: (req: LayoutRenderRequest) => Promise<LayoutRenderResult>
  /** Project model (Gradle init script) state for the layout's app module; refresh runs the read-only task now. */
  layoutModelStatus?: (req: { file: string }) => Promise<LayoutModelInfo | null>
  layoutModelRefresh?: (req: { file: string }) => Promise<LayoutModelInfo | null>
  /** Library layout: borrow the model of `module` (one of `library.candidates`). */
  layoutModelPick?: (req: { file: string; module: string }) => Promise<LayoutModelInfo | null>
  /** Layout opened: start the render daemon early (no Gradle). */
  layoutWarmup?: (req: { file: string }) => Promise<{ ok: boolean; code?: string } | null>
  /** v41: drawable / color state list XML (res/drawable*, mipmap*, color* or a loose file by root element). */
  drawableRender?: (req: import('./drawablePreview').DrawableRenderRequest) => Promise<import('./drawablePreview').DrawableRenderResult>
  onLayoutEvent?: (handler: (event: LayoutEvent) => void) => () => void
  /** Flutter widget preview (v40): `@Preview` list + one `flutter run` host session on a mobile device. */
  /** `withEntries: false` only finds the pubspec folder (toolbar button), no `lib/` walk. */
  fwpScan?: (path: string, withEntries?: boolean) => Promise<FwpScanResult>
  fwpStart?: (root: string, deviceId: string, flavor?: string | null) => Promise<FwpResult>
  fwpShow?: (id: string) => Promise<FwpResult>
  fwpStop?: () => Promise<FwpResult>
  fwpGet?: () => Promise<FwpSnapshot | null>
  onFwpState?: (handler: (snapshot: FwpSnapshot) => void) => () => void
}

/** Set by the Electron preload; absent in a plain browser, where terminals stay unavailable. */
export const desktop: DesktopBridge | undefined = (window as unknown as { ccmDesktop?: DesktopBridge }).ccmDesktop

export const titleBar: 'mac' | 'overlay' | null = desktop?.titleBar === 'mac' || desktop?.titleBar === 'overlay' ? desktop.titleBar : null

export const hasTerminals = typeof desktop?.ptyEndpoint === 'function'

export const hasExtensions = typeof desktop?.extStatus === 'function'

/** Off unless the app runs with CCM_DEEPSEEK_FEATURE=1: preload then exposes no DeepSeek bridge (owner pause, 2026-11-03). */
export const hasDeepSeek = typeof desktop?.deepseekStatus === 'function'

/** Whether a pane of this preset may be offered or started; callers pass `hasDeepSeek` (tests mock it). */
export const presetEnabled = (preset: string, deepseek: boolean): boolean => preset !== 'deepseek' || deepseek

export const hasRun = typeof desktop?.runDetect === 'function'
