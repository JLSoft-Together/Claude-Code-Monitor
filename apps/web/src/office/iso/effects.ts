import { frozen } from './bitmap'

export const WEB_SIZE = 15
export const WEB_INK = 'rgba(236,240,248,0.82)'
export const BALL_R = 1.6
export const PING_PERIOD = 1100
export const PING_TABLE_H = 15
export const PING_ARC = 10
export const BEACON_INSET = 10
export const BEACON_SPIN_MS = 900

export function pingPongBall(a: { x: number; y: number }, b: { x: number; y: number }, startAt: number, now: number): { x: number; y: number; arc: number } {
  const left = a.x <= b.x ? a : b
  const right = a.x <= b.x ? b : a
  const ph = (((now - startAt) % (PING_PERIOD * 2)) + PING_PERIOD * 2) % (PING_PERIOD * 2) / PING_PERIOD
  const u = ph < 1 ? ph : 2 - ph
  const inset = Math.min(9, Math.max(0, (right.x - left.x) / 2 - 1))
  const x = left.x + inset + (right.x - left.x - 2 * inset) * u
  const y = (left.y + right.y) / 2
  const arc = Math.sin(Math.PI * ((u * 2) % 1)) * PING_ARC
  return { x, y, arc }
}

export function drawCobweb(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, mirror: boolean): void {
  const dir = mirror ? -1 : 1
  const threads = 5
  const rings = [0.34, 0.64, 0.95]
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(dir, 1)
  ctx.strokeStyle = WEB_INK
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(0.35, size * 0.032)
  ctx.beginPath()
  for (let i = 0; i < threads; i++) {
    const a = (i / (threads - 1)) * (Math.PI / 2)
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size)
  }
  for (const r of rings) {
    for (let i = 0; i < threads - 1; i++) {
      const a0 = (i / (threads - 1)) * (Math.PI / 2)
      const a1 = ((i + 1) / (threads - 1)) * (Math.PI / 2)
      const am = (a0 + a1) / 2
      const p0x = Math.cos(a0) * size * r
      const p0y = Math.sin(a0) * size * r
      if (i === 0) ctx.moveTo(p0x, p0y)
      ctx.quadraticCurveTo(Math.cos(am) * size * r * 0.84, Math.sin(am) * size * r * 0.84, Math.cos(a1) * size * r, Math.sin(a1) * size * r)
    }
  }
  ctx.stroke()
  ctx.restore()
}

export function cobwebSide(seed: number, busyLeft: boolean, busyRight: boolean): 'left' | 'right' {
  let left = (seed & 1) === 0
  if (left ? busyLeft && !busyRight : busyRight && !busyLeft) left = !left
  return left ? 'left' : 'right'
}

export function drawBeacon(ctx: CanvasRenderingContext2D, x: number, y: number, ph: number, still: boolean): void {
  const facing = still ? 0.6 : Math.max(0, Math.cos(ph * Math.PI * 2))
  const r = 4.2
  ctx.save()
  ctx.fillStyle = '#5c6372'
  ctx.beginPath()
  ctx.roundRect(x - 5, y - 2.2, 10, 2.6, 1)
  ctx.fill()
  ctx.fillStyle = '#8d96a6'
  ctx.fillRect(x - 4.4, y - 2.2, 8.8, 0.9)
  const dome = ctx.createRadialGradient(x - 1.2, y - 5.2, 0.4, x, y - 3, r * 1.2)
  dome.addColorStop(0, '#ff9a9a')
  dome.addColorStop(0.45, '#ff3b3b')
  dome.addColorStop(1, '#9b161d')
  ctx.fillStyle = dome
  ctx.beginPath()
  ctx.arc(x, y - 2.2, r, Math.PI, 0)
  ctx.closePath()
  ctx.fill()
  if (facing > 0.05) {
    const off = still ? 0 : Math.sin(ph * Math.PI * 2) * 2.2
    ctx.globalAlpha *= facing
    ctx.fillStyle = '#fff4f4'
    ctx.beginPath()
    ctx.ellipse(x + off, y - 4.2, 1.2, 1.6, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawBang(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = 9
  const h = 11
  ctx.save()
  ctx.fillStyle = 'rgba(16,20,32,0.22)'
  ctx.beginPath()
  ctx.roundRect(x, y - h + 1, w, h, 3)
  ctx.fill()
  ctx.fillStyle = '#e5383b'
  ctx.strokeStyle = '#4a0d10'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.roundRect(x, y - h, w, h, 3)
  ctx.moveTo(x + 3, y)
  ctx.lineTo(x + 4.5, y + 2.6)
  ctx.lineTo(x + 6, y)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(x + w / 2 - 0.9, y - h + 2, 1.8, 4.6, 0.9)
  ctx.arc(x + w / 2, y - 2.4, 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawPopcornBucket(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const top = 4.4 * s
  const bottom = 3.2 * s
  const h = 5.6 * s
  ctx.save()
  ctx.fillStyle = '#fff6dc'
  for (const [dx, dy, r] of [
    [-1.4, -0.2, 1.3],
    [0.2, -0.9, 1.4],
    [1.5, -0.1, 1.2],
    [-0.4, 0.4, 1.1],
  ] as const) {
    ctx.beginPath()
    ctx.arc(x + dx * s, y - h + dy * s, r * s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#f2c75c'
  ctx.beginPath()
  ctx.arc(x + 0.7 * s, y - h - 0.3 * s, 0.5 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x - top / 2, y - h)
  ctx.lineTo(x + top / 2, y - h)
  ctx.lineTo(x + bottom / 2, y)
  ctx.lineTo(x - bottom / 2, y)
  ctx.closePath()
  ctx.fillStyle = '#f4f1ea'
  ctx.fill()
  ctx.clip()
  ctx.fillStyle = '#d8423f'
  for (let i = -2; i <= 2; i += 2) {
    ctx.beginPath()
    ctx.moveTo(x + (i - 0.5) * s, y - h)
    ctx.lineTo(x + (i + 0.5) * s, y - h)
    ctx.lineTo(x + (i * 0.7 + 0.35) * s, y)
    ctx.lineTo(x + (i * 0.7 - 0.35) * s, y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

const glows = new Map<string, CanvasImageSource | null>()

export function softGlow(rgb: readonly [number, number, number], size: number, alpha = 0.75): CanvasImageSource | null {
  const key = `${rgb.join(',')}:${size}:${alpha}`
  const hit = glows.get(key)
  if (hit !== undefined) return hit
  let c: HTMLCanvasElement | null = null
  try {
    c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')
    if (g) {
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      const [r, gg, b] = rgb
      grad.addColorStop(0, `rgba(${r},${gg},${b},${alpha})`)
      grad.addColorStop(0.45, `rgba(${r},${gg},${b},${alpha * 0.4})`)
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`)
      g.fillStyle = grad
      g.fillRect(0, 0, size, size)
    } else c = null
  } catch {
    c = null
  }
  const out = c && frozen(c)
  glows.set(key, out)
  return out
}
