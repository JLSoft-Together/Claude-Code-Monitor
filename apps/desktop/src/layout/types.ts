export const LAYOUTLIB_VERSION = '16.2.3'
/** The bundled layoutlib renders exactly one API level (its runtime build.prop); there is no per-render switch. */
export const LAYOUTLIB_API_LEVEL = 36

export type BundleStatus =
  | { state: 'missing' }
  | { state: 'downloading'; pct: number }
  | { state: 'ready'; dir: string }
  | { state: 'error'; code: string }

export type JdkStatus = { ok: true; home: string; version: number } | { ok: false; code: 'jdk-missing' | 'jdk-old'; detail?: string }

export type DaemonState = 'stopped' | 'starting' | 'ready' | 'failed'

export interface LayoutStatus {
  bundle: BundleStatus
  jdk: JdkStatus
  daemon: DaemonState
  /** Render daemon jar present (dev: `apps/layout-daemon` built). */
  jar: boolean
  /** Last cold-start stage while `daemon` is `starting` (v46). */
  stage?: InitStage | null
  /** API level layoutlib renders with (from `initialize`, else the bundled default). */
  apiLevel: number
}

export interface LayoutDevice {
  width: number
  height: number
  density: number
}

export interface LayoutViewNode {
  class: string
  xmlId: string | null
  line: number
  column: number
  bounds: [number, number, number, number]
  children: LayoutViewNode[]
}

export interface LayoutDiagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  line?: number
  column?: number
}

export interface DaemonRenderResult {
  requestId: string
  png: string | null
  width: number
  height: number
  viewTree: unknown
  diagnostics: unknown
  renderMs: number
}

export interface DaemonDrawableResult {
  requestId: string
  png: string | null
  width: number
  height: number
  swatches: unknown
  diagnostics: unknown
  renderMs: number
}

export interface DrawableSwatch {
  state: string
  /** `#AARRGGBB` */
  color: string
}

export type DrawableRenderResult =
  | {
      ok: true
      kind: 'drawable' | 'color'
      pngUrl: string | null
      width: number
      height: number
      swatches: DrawableSwatch[] | null
      diagnostics: LayoutDiagnostic[]
      renderMs: number
      frameworkOnly: boolean
      builtinLibs: boolean
      sourceOnly: boolean
      prebuiltAt?: number
    }
  | { ok: false; code: string; detail?: string }

export type LayoutRenderResult =
  | {
      ok: true
      pngUrl: string | null
      width: number
      height: number
      viewTree: LayoutViewNode | null
      diagnostics: LayoutDiagnostic[]
      renderMs: number
      /** No project model loaded: framework views only. */
      frameworkOnly: boolean
      /** No project model, the bundled ConstraintLayout / AppCompat / Material kit is loaded. */
      builtinLibs: boolean
      /** No Gradle model: project res read from res/ folders and cached library AARs, no project classes. */
      sourceOnly: boolean
      /** No Gradle model: classes from the project's last build (mtime of its R.jar). */
      prebuiltAt?: number
      /** Served from the render cache (same XML, config and model version). */
      cached: boolean
    }
  | { ok: false; code: string; detail?: string }

export type ModelState =
  | { state: 'none' }
  | { state: 'running'; since: number; compile?: boolean }
  | { state: 'ready'; at: number; resCount: number; classpathCount: number; warnings: number }
  | { state: 'error'; code: string; detail?: string; at: number }

export interface ModelTarget {
  /** Gradle root (settings.gradle[.kts]). */
  root: string
  /** Application module the model is taken from, e.g. `:app`. */
  module: string
}

export interface LayoutModelInfo {
  target: (ModelTarget & { name: string }) | null
  /** The layout lives in a library module: `target.module` is the app whose model is borrowed. */
  library?: { module: string; candidates: string[]; linked: boolean }
  /** Why there is no target: no Gradle root above the file, or no application module in it. */
  reason?: 'no-gradle' | 'no-app'
  state: ModelState
  /** A last good model is still loaded although `state` is `running` / `error`. */
  hasModel: boolean
  /** Theme names from the merged manifest (app + activities), for the theme picker. */
  themes: string[]
  /** `.kt` / `.java` of the model's modules changed after the model was built: custom views may be stale. */
  codeChanged?: boolean
}

export type LayoutEvent =
  | { type: 'bundle'; status: BundleStatus }
  | { type: 'daemon'; state: DaemonState; detail?: string }
  | { type: 'model'; root: string; module: string; state: ModelState }
  | { type: 'project-changed'; root: string; module: string }
  | { type: 'code-changed'; root: string; module: string }
  /** Cold start progress of the render JVM (v46). */
  | { type: 'daemon-stage'; stage: InitStage }
  /** A project model or the built-in library kit is being loaded into the daemon (v46). */
  | { type: 'loading'; kind: 'kit' | 'project'; active: boolean }

export type InitStage = 'jvm' | 'setup' | 'prepare' | 'warmup'
