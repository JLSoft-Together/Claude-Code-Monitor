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
  McpServerRow,
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
  dark: boolean
}

/** Run pane SDK / JDK folders; null = auto-detect. */
export interface RunSettings {
  flutterSdk: string | null
  androidSdk: string | null
  jdk: string | null
  /** Per-project Flutter SDK keyed by the resolved project dir (lower-cased on Windows). */
  flutterSdkProjects?: Record<string, string>
}

export type StatusLineState = 'ours' | 'other' | 'none' | 'unreadable'

interface DesktopBridge {
  platform: string
  ptyEndpoint: () => Promise<PtyEndpoint | null>
  /** `near`: the last project; the dialog opens in its parent folder. */
  pickFolder: (near?: string) => Promise<string | null>
  /** Theme canvas colour (#RRGGBB) for the native window background, kept for the next launch. */
  setWindowBackground?: (color: string) => Promise<boolean>
  /** Theme colours (#RRGGBB) for the startup screen and new windows. */
  setAppearance?: (look: DesktopLook) => Promise<boolean>
  /** App zoom (Chromium level, saved by the app); resolves to the new percent. */
  zoomApp?: (action: 'in' | 'out' | 'reset' | 'get') => Promise<number | null>
  /** Start with Windows / open at login: no argument reads, a boolean sets; null in a dev build. */
  loginItem?: (on?: boolean) => Promise<boolean | null>
  /** Claude Code's settings.json statusLine vs the bridge (quick setup). */
  statusLineState?: () => Promise<StatusLineState | null>
  /** Native confirm, then writes the bridge into settings.json. */
  enableStatusLine?: () => Promise<'ok' | 'ours' | 'unreadable' | 'failed' | 'cancelled'>
  /** Native folder picker; the folder becomes readable by browser / file tabs. */
  grantFolder?: () => Promise<string | null>
  logs?: (action: 'copy' | 'save', report: string) => Promise<{ ok: boolean; path?: string } | null>
  onFocus?: (handler: (terminalId: string) => boolean) => void
  onSelect?: (handler: (terminalId: string) => void) => void
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

export const hasTerminals = typeof desktop?.ptyEndpoint === 'function'

export const hasExtensions = typeof desktop?.extStatus === 'function'

export const hasRun = typeof desktop?.runDetect === 'function'
