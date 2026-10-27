import type { IconName } from '@ccm/habblaud/client/src/art/api'
import type { IconArt } from './isoArt'

export const HEAD_ICON_VIEW = 18
export const HELD_ICON_VIEW = 9
export const VECTOR_ICON_VIEW = 14

const INK = '#2a2420'
const EDGE = 'rgba(30,24,20,0.55)'
const WHITE = '#ffffff'
const ALERT_BG = '#ffb11f'
const QUESTION_BG = '#5b8def'
const CHECK_BG = '#3fae6a'
const HEART = '#e5484d'
const STAR = '#ffc83d'
const COIN = '#f2b632'
const COIN_RIM = '#c98a12'
const ZZZ = '#8fb4ff'
const SAND = '#e8b04a'
const GLASS = 'rgba(222,236,248,0.92)'
const FRAME = '#8a5a3c'

export const VECTOR_ICONS: ReadonlySet<IconName> = new Set<IconName>(['alert', 'question', 'check', 'heart', 'star', 'coin', 'zzz', 'hourglass', 'hourglass_flip'])

export interface IconRect {
  x: number
  y: number
  w: number
  h: number
}

export function iconViewRect(art: Pick<IconArt, 'img' | 'size' | 'anchor'>, x: number, y: number, view: number): IconRect {
  const k = view / Math.max(1, art.size[0], art.size[1])
  return { x: x - art.anchor[0] * k, y: y - art.anchor[1] * k, w: art.img.w * k, h: art.img.h * k }
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string): void {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = Math.max(0.6, r * 0.14)
  ctx.strokeStyle = EDGE
  ctx.stroke()
}

function bang(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const w = r * 0.26
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.roundRect(cx - w / 2, cy - r * 0.62, w, r * 0.82, w / 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy + r * 0.45, w * 0.6, 0, Math.PI * 2)
  ctx.fill()
}

function question(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = WHITE
  ctx.lineWidth = r * 0.24
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy - r * 0.22, r * 0.32, Math.PI * 1.05, Math.PI * 0.45)
  ctx.lineTo(cx, cy + r * 0.2)
  ctx.stroke()
  ctx.fillStyle = WHITE
  ctx.beginPath()
  ctx.arc(cx, cy + r * 0.52, r * 0.14, 0, Math.PI * 2)
  ctx.fill()
}

function check(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = WHITE
  ctx.lineWidth = r * 0.24
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.45, cy + r * 0.02)
  ctx.lineTo(cx - r * 0.12, cy + r * 0.34)
  ctx.lineTo(cx + r * 0.46, cy - r * 0.3)
  ctx.stroke()
}

function heart(ctx: CanvasRenderingContext2D, cx: number, bottom: number, s: number): void {
  const top = bottom - s * 0.86
  ctx.beginPath()
  ctx.moveTo(cx, bottom)
  ctx.bezierCurveTo(cx - s * 0.62, bottom - s * 0.38, cx - s * 0.5, top - s * 0.1, cx, top + s * 0.22)
  ctx.bezierCurveTo(cx + s * 0.5, top - s * 0.1, cx + s * 0.62, bottom - s * 0.38, cx, bottom)
  ctx.closePath()
  ctx.fillStyle = HEART
  ctx.fill()
  ctx.lineWidth = Math.max(0.6, s * 0.07)
  ctx.strokeStyle = EDGE
  ctx.stroke()
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    if (i) ctx.lineTo(x, y)
    else ctx.moveTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = STAR
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(0.6, r * 0.12)
  ctx.strokeStyle = EDGE
  ctx.stroke()
}

function zzz(ctx: CanvasRenderingContext2D, x: number, bottom: number, s: number): void {
  ctx.strokeStyle = ZZZ
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const parts: [number, number, number][] = [
    [-0.42, 0, 0.34],
    [-0.02, -0.34, 0.28],
    [0.32, -0.62, 0.22],
  ]
  for (const [dx, dy, k] of parts) {
    const w = s * k
    const l = x + s * dx
    const b = bottom + s * dy
    ctx.lineWidth = Math.max(0.8, w * 0.22)
    ctx.beginPath()
    ctx.moveTo(l, b - w)
    ctx.lineTo(l + w, b - w)
    ctx.lineTo(l, b)
    ctx.lineTo(l + w, b)
    ctx.stroke()
  }
}

function hourglass(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, turned: boolean): void {
  ctx.save()
  ctx.translate(cx, cy)
  if (turned) ctx.rotate(Math.PI / 2)
  const hw = s * 0.32
  const hh = s * 0.46
  ctx.fillStyle = GLASS
  ctx.beginPath()
  ctx.moveTo(-hw, -hh)
  ctx.lineTo(hw, -hh)
  ctx.lineTo(hw * 0.12, 0)
  ctx.lineTo(hw, hh)
  ctx.lineTo(-hw, hh)
  ctx.lineTo(-hw * 0.12, 0)
  ctx.closePath()
  ctx.fill()
  ctx.lineWidth = Math.max(0.6, s * 0.06)
  ctx.strokeStyle = EDGE
  ctx.stroke()
  ctx.fillStyle = SAND
  ctx.beginPath()
  ctx.moveTo(-hw * 0.6, -hh * 0.55)
  ctx.lineTo(hw * 0.6, -hh * 0.55)
  ctx.lineTo(0, -hh * 0.05)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0, hh * 0.45)
  ctx.lineTo(hw * 0.75, hh * 0.88)
  ctx.lineTo(-hw * 0.75, hh * 0.88)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = FRAME
  const bar = s * 0.12
  ctx.beginPath()
  ctx.roundRect(-hw * 1.18, -hh - bar, hw * 2.36, bar, bar / 2)
  ctx.roundRect(-hw * 1.18, hh, hw * 2.36, bar, bar / 2)
  ctx.fill()
  ctx.restore()
}

export function drawVectorIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, bottom: number, size = VECTOR_ICON_VIEW): IconRect | null {
  if (!VECTOR_ICONS.has(name)) return null
  const r = size / 2
  const cy = bottom - r
  ctx.save()
  switch (name) {
    case 'alert':
      disc(ctx, x, cy, r, ALERT_BG)
      bang(ctx, x, cy, r)
      break
    case 'question':
      disc(ctx, x, cy, r, QUESTION_BG)
      question(ctx, x, cy, r)
      break
    case 'check':
      disc(ctx, x, cy, r, CHECK_BG)
      check(ctx, x, cy, r)
      break
    case 'coin':
      disc(ctx, x, cy, r * 0.8, COIN)
      ctx.beginPath()
      ctx.arc(x, cy, r * 0.48, 0, Math.PI * 2)
      ctx.lineWidth = Math.max(0.6, r * 0.12)
      ctx.strokeStyle = COIN_RIM
      ctx.stroke()
      break
    case 'heart':
      heart(ctx, x, bottom, size)
      break
    case 'star':
      star(ctx, x, cy, r)
      break
    case 'zzz':
      zzz(ctx, x, bottom, size)
      break
    case 'hourglass':
    case 'hourglass_flip':
      hourglass(ctx, x, cy, size, name === 'hourglass_flip')
      break
  }
  ctx.restore()
  return { x: x - r, y: bottom - size, w: size, h: size }
}
