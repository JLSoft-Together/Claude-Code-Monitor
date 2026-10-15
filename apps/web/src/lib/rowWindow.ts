/** Code / diff views render every row up to this many; above it only a window around the viewport. */
export const WINDOW_MIN_ROWS = 3000
/** Rows re-render in steps of CHUNK, so scrolling inside the rendered range costs nothing. */
const CHUNK = 64
const OVERSCAN_PX = 1200

export interface RowRange {
  start: number
  end: number
}

/** offsets[i] = top of row i, offsets[n] = total height. */
export function prefixOffsets(n: number, height: (i: number) => number): Float64Array {
  const out = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) out[i + 1] = out[i]! + height(i)
  return out
}

/** Row holding content offset `y` (clamped to the rows). */
export function rowAtOffset(offsets: Float64Array, y: number): number {
  const n = offsets.length - 1
  if (n <= 0) return 0
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid]! <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Rows to render for viewport `[top, top + height)` (content coordinates), snapped to CHUNK so it changes rarely. */
export function windowRange(offsets: Float64Array, top: number, height: number): RowRange {
  const n = offsets.length - 1
  if (n <= 0) return { start: 0, end: 0 }
  const a = rowAtOffset(offsets, top - OVERSCAN_PX)
  const b = rowAtOffset(offsets, top + height + OVERSCAN_PX) + 1
  return { start: Math.floor(a / CHUNK) * CHUNK, end: Math.min(n, Math.ceil(b / CHUNK) * CHUNK) }
}

export const sameRange = (a: RowRange, b: RowRange): boolean => a.start === b.start && a.end === b.end

/** Spacer keeping the scroll height of the rows left out. */
export const spacer = (px: number): string => `<div class="ccm-spacer" style="height:${Math.max(0, px)}px" aria-hidden="true"></div>`

/** Same for rows of one height. */
export function uniformRange(n: number, rowH: number, top: number, height: number): RowRange {
  if (n <= 0 || rowH <= 0) return { start: 0, end: 0 }
  const a = Math.max(0, Math.floor((top - OVERSCAN_PX) / rowH))
  const b = Math.min(n, Math.ceil((top + height + OVERSCAN_PX) / rowH))
  return { start: Math.min(n, Math.floor(a / CHUNK) * CHUNK), end: Math.min(n, Math.ceil(b / CHUNK) * CHUNK) }
}

/** Widest line in columns (tabs = 4), so a windowed view keeps one horizontal scroll width. */
export function maxColumns(lines: readonly string[]): number {
  let max = 0
  for (const l of lines) {
    if (l.length * 4 <= max) continue
    let col = 0
    for (let i = 0; i < l.length; i++) col += l.charCodeAt(i) === 9 ? 4 - (col % 4) : 1
    if (col > max) max = col
  }
  return max
}
