import { desktop } from './desktop'

export type BundleStatus = { state: 'missing' } | { state: 'downloading'; pct: number } | { state: 'ready'; dir: string } | { state: 'error'; code: string }
export type JdkStatus = { ok: true; home: string; version: number } | { ok: false; code: 'jdk-missing' | 'jdk-old'; detail?: string }
export type DaemonState = 'stopped' | 'starting' | 'ready' | 'failed'

export interface LayoutStatus {
  bundle: BundleStatus
  jdk: JdkStatus
  daemon: DaemonState
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

export type LayoutRenderResult =
  | {
      ok: true
      pngUrl: string | null
      width: number
      height: number
      viewTree: LayoutViewNode | null
      diagnostics: LayoutDiagnostic[]
      renderMs: number
      frameworkOnly?: boolean
      cached?: boolean
    }
  | { ok: false; code: string; detail?: string }

export type ModelState =
  | { state: 'none' }
  | { state: 'running'; since: number }
  | { state: 'ready'; at: number; resCount: number; classpathCount: number; warnings: number }
  | { state: 'error'; code: string; detail?: string; at: number }

export interface LayoutModelInfo {
  target: { root: string; module: string; name: string } | null
  reason?: 'no-gradle' | 'no-app'
  state: ModelState
  hasModel: boolean
  themes: string[]
}

export interface LayoutRenderRequest {
  file: string
  device: LayoutDevice
  theme: string | null
  night: boolean
  locale: string | null
  /** 0 = main view, 1..3 = compare cells; renders of different slots do not cancel each other. */
  slot?: number
}

export type LayoutEvent =
  | { type: 'bundle'; status: BundleStatus }
  | { type: 'daemon'; state: DaemonState; detail?: string }
  | { type: 'model'; root: string; module: string; state: ModelState }
  | { type: 'project-changed'; root: string; module: string }

export type LayoutMode = 'code' | 'split' | 'design'

export interface DevicePreset {
  id: string
  width: number
  height: number
  density: number
}

/** Portrait pixels + dpi, as Android Studio's device catalogue lists them. */
export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: 'pixel5', width: 1080, height: 2340, density: 440 },
  { id: 'pixel8pro', width: 1344, height: 2992, density: 480 },
  { id: 'small', width: 720, height: 1280, density: 320 },
  { id: 'tablet', width: 1600, height: 2560, density: 320 },
  { id: 'foldable', width: 1840, height: 2208, density: 420 },
]

export const LOCALES = ['en', 'vi', 'ja', 'de', 'ar'] as const

export const ZOOMS = [25, 50, 75, 100] as const

export const hasLayoutPreview = typeof desktop?.layoutRender === 'function'

export function deviceFor(id: string, landscape: boolean): LayoutDevice {
  const p = DEVICE_PRESETS.find((d) => d.id === id) ?? DEVICE_PRESETS[0]!
  return landscape ? { width: p.height, height: p.width, density: p.density } : { width: p.width, height: p.height, density: p.density }
}

/** Size in dp, the unit the device menu shows. */
export function dpSize(d: LayoutDevice): { width: number; height: number } {
  return { width: Math.round((d.width * 160) / d.density), height: Math.round((d.height * 160) / d.density) }
}

/** Scale that fits `w×h` inside the box (never above 1: the image is already device pixels). */
export function fitScale(w: number, h: number, boxW: number, boxH: number): number {
  if (w <= 0 || h <= 0 || boxW <= 0 || boxH <= 0) return 1
  return Math.min(1, boxW / w, boxH / h)
}

export function isLayoutXml(path: string): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const n = parts.length
  return n >= 3 && /\.xml$/i.test(parts[n - 1]!) && /^layout(-[A-Za-z0-9_+-]+)?$/i.test(parts[n - 2]!) && parts[n - 3]!.toLowerCase() === 'res'
}

export const shortClass = (cls: string): string => cls.slice(cls.lastIndexOf('.') + 1)

const contains = (n: LayoutViewNode, x: number, y: number): boolean => x >= n.bounds[0] && x < n.bounds[2] && y >= n.bounds[1] && y < n.bounds[3]

/** Deepest view under the point (image px); later siblings are drawn on top, so they win. */
export function hitTest(root: LayoutViewNode | null, x: number, y: number): LayoutViewNode | null {
  if (!root || !contains(root, x, y)) return null
  for (let i = root.children.length - 1; i >= 0; i--) {
    const hit = hitTest(root.children[i]!, x, y)
    if (hit) return hit
  }
  return root
}

export function flattenTree(root: LayoutViewNode | null): LayoutViewNode[] {
  const out: LayoutViewNode[] = []
  const walk = (n: LayoutViewNode): void => {
    out.push(n)
    n.children.forEach(walk)
  }
  if (root) walk(root)
  return out
}

/**
 * View for a 1-based XML line: the deepest view whose start tag begins there, else the nearest start tag above it
 * (a click on an attribute line of a multi-line tag). Synthetic nodes (line 0) never match.
 */
export function nodeForLine(root: LayoutViewNode | null, line: number): LayoutViewNode | null {
  let best: LayoutViewNode | null = null
  let bestDepth = -1
  const walk = (n: LayoutViewNode, depth: number): void => {
    if (n.line > 0 && n.line <= line && (!best || n.line > best.line || (n.line === best.line && depth > bestDepth))) {
      best = n
      bestDepth = depth
    }
    for (const c of n.children) walk(c, depth + 1)
  }
  if (root) walk(root, 0)
  return best
}

export const layoutStatus = (): Promise<LayoutStatus | null> => desktop?.layoutStatus?.() ?? Promise.resolve(null)
export const layoutDownload = (): Promise<BundleStatus | { state: 'cancelled' } | null> => desktop?.layoutDownload?.() ?? Promise.resolve(null)
export const layoutRender = (req: LayoutRenderRequest): Promise<LayoutRenderResult> =>
  desktop?.layoutRender?.(req) ?? Promise.resolve({ ok: false, code: 'unavailable' })
export const onLayoutEvent = (handler: (e: LayoutEvent) => void): (() => void) => desktop?.onLayoutEvent?.(handler) ?? (() => undefined)

export const layoutModelStatus = (file: string): Promise<LayoutModelInfo | null> => desktop?.layoutModelStatus?.({ file }) ?? Promise.resolve(null)
export const layoutModelRefresh = (file: string): Promise<LayoutModelInfo | null> => desktop?.layoutModelRefresh?.({ file }) ?? Promise.resolve(null)

/** Theme picker value for "let the daemon resolve tools:context → app theme". */
export const THEME_AUTO = ''
export const THEME_DAYNIGHT = 'android:Theme.DeviceDefault.DayNight'

export type ModelChipKind = 'framework' | 'ready' | 'running' | 'error'

export function modelChip(info: LayoutModelInfo | null): { kind: ModelChipKind; at?: number; code?: string } {
  if (!info?.target) return { kind: 'framework' }
  const s = info.state
  if (s.state === 'running') return { kind: 'running' }
  if (s.state === 'ready') return { kind: 'ready', at: s.at }
  if (s.state === 'error') return { kind: 'error', code: s.code }
  return { kind: 'framework' }
}

/** Framework-only render that hit project / library classes: worth pointing at the project model. */
export function needsModelNotice(frameworkOnly: boolean, diagnostics: readonly LayoutDiagnostic[]): boolean {
  return frameworkOnly && diagnostics.some((d) => /class not found/i.test(d.message))
}

export interface CompareConfig {
  id: 'light' | 'dark' | 'other'
  deviceId: string
  device: LayoutDevice
  night: boolean
}

/** Up to three side-by-side configurations: current device light + dark, then the other form factor. */
export function compareConfigs(deviceId: string, landscape: boolean): CompareConfig[] {
  const other = deviceId === 'tablet' ? 'pixel5' : 'tablet'
  return [
    { id: 'light', deviceId, device: deviceFor(deviceId, landscape), night: false },
    { id: 'dark', deviceId, device: deviceFor(deviceId, landscape), night: true },
    { id: 'other', deviceId: other, device: deviceFor(other, landscape), night: false },
  ]
}

/** Cell width + image scale for `n` compare cells; cells never exceed the box, so the strip wraps instead of scrolling sideways. */
export function compareCell(w: number, h: number, boxW: number, boxH: number, n: number, gap = 16, minCell = 180): { cellWidth: number; scale: number } {
  const avail = Math.max(1, boxW - 32)
  const cellWidth = Math.min(avail, Math.max(minCell, Math.floor((avail - gap * (n - 1)) / Math.max(1, n))))
  return { cellWidth, scale: fitScale(w, h, cellWidth, Math.max(1, boxH - 64)) }
}

/** Compare cell for a zoom choice: 'fit' wraps inside the box; a fixed % uses the same scale for every cell so sizes stay comparable. */
export function compareCellAt(w: number, h: number, boxW: number, boxH: number, n: number, zoom: 'fit' | number): { cellWidth: number; scale: number } {
  if (zoom === 'fit') return compareCell(w, h, boxW, boxH, n)
  const scale = zoom / 100
  return { cellWidth: Math.max(1, Math.round(w * scale)), scale }
}

export const BLUEPRINT_MAX = 800

/** Box of view bounds (image px) at `scale`, at least 1 px each way so hairline views stay visible. */
export function boxRect(bounds: readonly [number, number, number, number], scale: number): { left: number; top: number; width: number; height: number } {
  const [l, t, r, b] = bounds
  return { left: l * scale, top: t * scale, width: Math.max(1, (r - l) * scale), height: Math.max(1, (b - t) * scale) }
}
