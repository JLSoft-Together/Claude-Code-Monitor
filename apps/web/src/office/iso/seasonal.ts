import type { SeasonalTheme } from '@ccm/habblaud/client/src/world'
import type { WallSegment } from '@ccm/habblaud/client/src/world/layout/types'
import { drawCobweb } from './effects'

export const GARLAND_INSET = 3
export const GARLAND_TOP = 5
export const GARLAND_SCALLOP = 48
export const GARLAND_SAG = 3
export const ORNAMENT_STEP = 12
export const BULB_START = 14
export const BULB_STEP = 24
export const BULB_Y = 10
export const CORNER_WEB = 15

const GARLAND = { christmas: '#347653', halloween: '#584068' } as const
const ORNAMENT = { christmas: '#f5d491', halloween: '#eea24d' } as const
const ORNAMENT_HI = { christmas: '#fff0be', halloween: '#ffd78a' } as const
export const BULB = { christmas: '#ffe4a9', halloween: '#ffd181' } as const
export const BULB_GLOW_RGB = { christmas: [255, 213, 139], halloween: [216, 165, 237] } as const

type Decorated = Exclude<SeasonalTheme, 'none'>

export function garlandSag(x: number, x0: number): number {
  return Math.sin((((x - x0) % GARLAND_SCALLOP) / GARLAND_SCALLOP) * Math.PI) * GARLAND_SAG
}

export function garlandSpan(seg: Pick<WallSegment, 'x' | 'w'>, piece: { x0: number; x1: number }): [number, number] | null {
  const a = Math.max(seg.x + GARLAND_INSET, piece.x0 + 1)
  const b = Math.min(seg.x + seg.w - GARLAND_INSET, piece.x1 - 1)
  return b - a >= 2 ? [a, b] : null
}

export function drawGarland(ctx: CanvasRenderingContext2D, theme: Decorated, seg: Pick<WallSegment, 'x' | 'y' | 'w'>, span: [number, number]): void {
  const x0 = seg.x + GARLAND_INSET
  const top = seg.y + GARLAND_TOP
  const [a, b] = span
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = GARLAND[theme]
  ctx.lineWidth = theme === 'christmas' ? 2.2 : 0.9
  ctx.beginPath()
  ctx.moveTo(a, top + garlandSag(a, x0))
  for (let x = a + 2; x < b; x += 2) ctx.lineTo(x, top + garlandSag(x, x0))
  ctx.lineTo(b, top + garlandSag(b, x0))
  ctx.stroke()
  const first = x0 + Math.ceil((a - x0 - ORNAMENT_STEP / 2) / ORNAMENT_STEP) * ORNAMENT_STEP + ORNAMENT_STEP / 2
  for (let x = first; x <= b; x += ORNAMENT_STEP) {
    if (x < a) continue
    const y = top + garlandSag(x, x0) + 4
    ctx.fillStyle = ORNAMENT[theme]
    ctx.beginPath()
    ctx.arc(x, y, 1.3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = ORNAMENT_HI[theme]
    ctx.beginPath()
    ctx.arc(x - 0.4, y - 0.4, 0.45, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawCornerWebs(ctx: CanvasRenderingContext2D, seg: Pick<WallSegment, 'x' | 'y' | 'w'>, piece: { x0: number; x1: number }): void {
  const y = seg.y + GARLAND_TOP + 2
  const left = seg.x + GARLAND_INSET
  const right = seg.x + seg.w - GARLAND_INSET
  if (left >= piece.x0 && left + CORNER_WEB <= piece.x1) drawCobweb(ctx, left, y, CORNER_WEB, false)
  if (right <= piece.x1 && right - CORNER_WEB >= piece.x0) drawCobweb(ctx, right, y, CORNER_WEB, true)
}

export function bulbSpots(seg: { kind: WallSegment['kind']; x: number; y: number; w: number; doorways?: readonly { x: number; w: number }[] }): { x: number; y: number }[] {
  if (seg.kind !== 'face') return []
  const out: { x: number; y: number }[] = []
  for (let x = seg.x + BULB_START; x < seg.x + seg.w - 6; x += BULB_STEP) {
    if (seg.doorways?.some((d) => x >= d.x - 10 && x <= d.x + d.w + 10)) continue
    out.push({ x: x + 1, y: seg.y + BULB_Y })
  }
  return out
}
