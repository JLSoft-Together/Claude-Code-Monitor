import { readFileSync, writeFileSync } from 'node:fs'

/** Theme colours picked in the page (all #RRGGBB), so the startup screen and a new window match it before it loads. */
export interface Look {
  canvas: string
  surface: string
  ink: string
  muted: string
  faint: string
  accent: string
  bar?: string
  dark: boolean
}

export interface Appearance {
  background?: string
  look?: Look
  /** Chromium zoom level of the app pages (0 = 100%). */
  zoom?: number
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i
const LOOK_KEYS = ['canvas', 'surface', 'ink', 'muted', 'faint', 'accent'] as const

export function parseLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  for (const key of LOOK_KEYS) if (typeof r[key] !== 'string' || !HEX_COLOR.test(r[key] as string)) return null
  if (typeof r.dark !== 'boolean') return null
  if (r.bar !== undefined && (typeof r.bar !== 'string' || !HEX_COLOR.test(r.bar))) return null
  const look = Object.fromEntries(LOOK_KEYS.map((k) => [k, (r[k] as string).toLowerCase()])) as Omit<Look, 'dark'>
  return { ...look, ...(typeof r.bar === 'string' ? { bar: r.bar.toLowerCase() } : {}), dark: r.dark }
}

export const ZOOM_MIN = -3
export const ZOOM_MAX = 3
export const ZOOM_STEP = 0.5

export const clampZoom = (level: unknown): number =>
  typeof level === 'number' && Number.isFinite(level) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(level / ZOOM_STEP) * ZOOM_STEP)) : 0

export type ZoomAction = 'in' | 'out' | 'reset'
export const isZoomAction = (v: unknown): v is ZoomAction => v === 'in' || v === 'out' || v === 'reset'

export function nextZoom(level: number, action: ZoomAction): number {
  if (action === 'reset') return 0
  return clampZoom(level + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP))
}

/** Chromium zoom level → percent (each level is a factor of 1.2). */
export const zoomPercent = (level: number): number => Math.round(100 * 1.2 ** level)

export function readAppearance(file: string): Appearance {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const out: Appearance = {}
    if (typeof raw.background === 'string' && HEX_COLOR.test(raw.background)) out.background = raw.background
    const look = parseLook(raw.look)
    if (look) out.look = look
    if (raw.zoom !== undefined) out.zoom = clampZoom(raw.zoom)
    return out
  } catch {
    return {}
  }
}

export function writeAppearance(file: string, appearance: Appearance): void {
  try {
    writeFileSync(file, JSON.stringify(appearance))
  } catch {
    // Only the next launch's first frame and zoom depend on it.
  }
}
