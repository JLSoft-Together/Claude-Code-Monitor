export const LAYOUTLIB_VERSION = '16.2.3'

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
      /** Served from the render cache (same XML, config and model version). */
      cached: boolean
    }
  | { ok: false; code: string; detail?: string }

export type ModelState =
  | { state: 'none' }
  | { state: 'running'; since: number }
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
  /** Why there is no target: no Gradle root above the file, or no application module in it. */
  reason?: 'no-gradle' | 'no-app'
  state: ModelState
  /** A last good model is still loaded although `state` is `running` / `error`. */
  hasModel: boolean
  /** Theme names from the merged manifest (app + activities), for the theme picker. */
  themes: string[]
}

export type LayoutEvent =
  | { type: 'bundle'; status: BundleStatus }
  | { type: 'daemon'; state: DaemonState; detail?: string }
  | { type: 'model'; root: string; module: string; state: ModelState }
  | { type: 'project-changed'; root: string; module: string }
