import { ISO_FONT_FAMILY } from './fonts'

export const SIGN_PAD_X = 0.3
export const SIGN_SIZE_MAX = 0.6
export const SIGN_SIZE_READ = 0.5
export const SIGN_SIZE_MIN = 0.42
export const SIGN_LINE = 1.12
export const SIGN_STRETCH_MAX = 1.6
export const SIGN_GAP = 3

const SHRINK = 0.94
const BREAK_AFTER = new Set(['-', '_', '.', '/', ' ', ':'])

export type Measure = (font: string, text: string) => number

export interface SignFit {
  lines: string[]
  font: string
  size: number
  growW: number
  growH: number
}

export function signFont(size: number): string {
  return `600 ${size.toFixed(2)}px ${ISO_FONT_FAMILY}`
}

export function ellipsize(measure: Measure, font: string, text: string, maxW: number): string {
  if (measure(font, text) <= maxW) return text
  const chars = Array.from(text)
  const cut = (n: number) => `${chars.slice(0, n).join('').trimEnd()}…`
  let lo = 0
  let hi = chars.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(font, cut(mid)) <= maxW) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? cut(lo) : ''
}

export function splitName(text: string, width: (s: string) => number): [string, string] | null {
  const chars = Array.from(text)
  if (chars.length < 2) return null
  const soft: number[] = []
  for (let i = 1; i < chars.length; i++) {
    const prev = chars[i - 1]!
    const cur = chars[i]!
    if (BREAK_AFTER.has(prev)) soft.push(i)
    else if (/\p{Ll}/u.test(prev) && /\p{Lu}/u.test(cur)) soft.push(i)
  }
  const cands = soft.length ? soft : chars.map((_, i) => i).slice(1)
  let best: [string, string] | null = null
  let bestW = Infinity
  for (const i of cands) {
    const a = chars.slice(0, i).join('').trimEnd()
    const b = chars.slice(i).join('').trimStart()
    if (!a || !b) continue
    const w = Math.max(width(a), width(b))
    if (w <= bestW) {
      bestW = w
      best = [a, b]
    }
  }
  return best
}

export function fitSign(measure: Measure, text: string, box: { w: number; h: number }, maxGrowW: number, maxGrowH: number): SignFit {
  const h = box.h
  const inner = Math.max(1, box.w - 2 * h * SIGN_PAD_X)
  const roomW = Math.max(0, maxGrowW)
  const widest = inner + roomW
  const big = h * SIGN_SIZE_MAX
  const read = h * SIGN_SIZE_READ
  const min = h * SIGN_SIZE_MIN
  const one = (size: number): SignFit => {
    const font = signFont(size)
    const w = measure(font, text)
    return { lines: [text], font, size, growW: Math.min(roomW, Math.max(0, w - inner)), growH: 0 }
  }
  if (measure(signFont(big), text) <= widest) return one(big)
  let size = big
  while (size > read && measure(signFont(size), text) > widest) size = Math.max(read, size * SHRINK)
  if (measure(signFont(size), text) <= widest) return one(size)
  const lineGrow = (s: number) => s * SIGN_LINE
  const parts = splitName(text, (s) => measure(signFont(big), s))
  if (parts && maxGrowH > 0) {
    let s2 = big
    const longest = (s: number) => Math.max(measure(signFont(s), parts[0]), measure(signFont(s), parts[1]))
    while (s2 > min && (longest(s2) > widest || lineGrow(s2) > maxGrowH)) s2 = Math.max(min, s2 * SHRINK)
    if (lineGrow(s2) <= maxGrowH + 1e-9) {
      const font = signFont(s2)
      const lines = parts.map((p) => ellipsize(measure, font, p, widest)).filter(Boolean)
      if (lines.length === 2) {
        const w = Math.max(...lines.map((l) => measure(font, l)))
        return { lines, font, size: s2, growW: Math.min(roomW, Math.max(0, w - inner)), growH: lineGrow(s2) }
      }
    }
  }
  const font = signFont(read)
  const cut = ellipsize(measure, font, text, widest)
  return { lines: cut ? [cut] : [], font, size: read, growW: cut ? Math.min(roomW, Math.max(0, measure(font, cut) - inner)) : 0, growH: 0 }
}

export function signLineYs(fit: Pick<SignFit, 'lines' | 'size'>, cy: number, glyphShift: number): number[] {
  const adv = fit.size * SIGN_LINE
  const n = fit.lines.length
  return fit.lines.map((_, i) => cy + (i - (n - 1) / 2) * adv + glyphShift)
}

export interface Span {
  x0: number
  x1: number
}

export function signSpare(sign: Span, wall: Span, others: readonly Span[], gap = SIGN_GAP): number {
  const cx = (sign.x0 + sign.x1) / 2
  let left = sign.x0 - (wall.x0 + gap)
  let right = wall.x1 - gap - sign.x1
  for (const o of others) {
    const ocx = (o.x0 + o.x1) / 2
    if (o.x1 > sign.x0 && o.x0 < sign.x1) continue
    if (ocx < cx) left = Math.min(left, sign.x0 - o.x1 - gap)
    else right = Math.min(right, o.x0 - sign.x1 - gap)
  }
  return Math.max(0, 2 * Math.min(left, right))
}

export interface SliceRect {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

export function nineSlice(img: { w: number; h: number }, center: readonly [number, number, number, number], dst: { x: number; y: number; w: number; h: number }, growW: number, growH: number): SliceRect[] {
  const kx = dst.w / img.w
  const ky = dst.h / img.h
  const [cx, cy, cw, ch] = center
  const sxs = [0, cx, cx + cw, img.w]
  const sys = [0, cy, cy + ch, img.h]
  const dws = [cx * kx, cw * kx + growW, (img.w - cx - cw) * kx]
  const dhs = [cy * ky, ch * ky + growH, (img.h - cy - ch) * ky]
  const out: SliceRect[] = []
  let dy = dst.y
  for (let j = 0; j < 3; j++) {
    let dx = dst.x - growW / 2
    for (let i = 0; i < 3; i++) {
      const sw = sxs[i + 1]! - sxs[i]!
      const sh = sys[j + 1]! - sys[j]!
      if (sw > 0 && sh > 0 && dws[i]! > 0 && dhs[j]! > 0) out.push({ sx: sxs[i]!, sy: sys[j]!, sw, sh, dx, dy, dw: dws[i]!, dh: dhs[j]! })
      dx += dws[i]!
    }
    dy += dhs[j]!
  }
  return out
}
