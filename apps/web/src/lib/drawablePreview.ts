import { DRAWABLE_SNIFF_BYTES, drawableKind, type DrawableKind } from '@ccm/shared'
import { desktop } from './desktop'
import type { LayoutDiagnostic } from './layoutPreview'

export interface DrawableSwatch {
  state: string
  /** `#AARRGGBB` */
  color: string
}

export type DrawableRenderResult =
  | {
      ok: true
      kind: DrawableKind
      pngUrl: string | null
      width: number
      height: number
      swatches: DrawableSwatch[] | null
      diagnostics: LayoutDiagnostic[]
      renderMs: number
      frameworkOnly: boolean
      sourceOnly?: boolean
    }
  | { ok: false; code: string; detail?: string }

export interface DrawableRenderRequest {
  file: string
  /** dp */
  width: number
  height: number
  density: number
  night: boolean
  states: string[]
  /** v42: unsaved editor text rendered instead of the file. */
  text?: string
}

export const DRAWABLE_SIZES = [24, 48, 96] as const
export const DRAWABLE_STATES = ['pressed', 'focused', 'selected', 'checked', 'activated', 'disabled'] as const
export const DRAWABLE_ZOOMS = [100, 200, 400, 800] as const
/** xxhdpi: crisp at 100 % on HiDPI screens, small enough for an instant render. */
export const DRAWABLE_DPI = 480
export const MAX_FIT_SCALE = 8

export const hasDrawablePreview = typeof desktop?.drawableRender === 'function'

/** Folder (`res/drawable*`, `mipmap*`, `color*`) or, for a loose XML file, its root element in the first 4 KB. */
export function isDrawableXml(path: string, text: string | null): DrawableKind | null {
  return drawableKind(path, text === null ? null : text.slice(0, DRAWABLE_SNIFF_BYTES))
}

/** Image scale: fit grows small icons up to ×8 inside the box; a fixed zoom is relative to device pixels. */
export function drawableScale(w: number, h: number, boxW: number, boxH: number, zoom: 'fit' | number): number {
  if (zoom !== 'fit') return zoom / 100
  if (w <= 0 || h <= 0 || boxW <= 0 || boxH <= 0) return 1
  return Math.min(MAX_FIT_SCALE, boxW / w, boxH / h)
}

/** `#AARRGGBB` → CSS `rgb(r g b / a)`. */
export function cssColor(argb: string): string {
  const n = Number.parseInt(argb.slice(1), 16)
  const a = ((n >>> 24) & 0xff) / 255
  return `rgb(${(n >>> 16) & 0xff} ${(n >>> 8) & 0xff} ${n & 0xff} / ${Math.round(a * 1000) / 1000})`
}

/** Swatch the current chips select: the first chosen state that has a swatch, else default. */
export function currentSwatch(states: readonly string[]): string {
  if (states.includes('disabled')) return 'disabled'
  return DRAWABLE_STATES.find((s) => s !== 'disabled' && states.includes(s)) ?? 'default'
}

export const drawableRender = (req: DrawableRenderRequest): Promise<DrawableRenderResult> =>
  desktop?.drawableRender?.(req) ?? Promise.resolve({ ok: false, code: 'unavailable' })
