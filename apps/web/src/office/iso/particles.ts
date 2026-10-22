import { CONFETTI_COLORS } from '@ccm/habblaud/client/src/world/render/particles'

export const FX_SCALE = 2

const enum PK {
  Popcorn,
  Confetti,
  Rain,
  Coin,
  Sparkle,
}

const POPCORN_BODY = '#fff6dc'
const POPCORN_SHADE = '#f2c75c'
const RAIN_COLOR = '#7cc4ff'
const COIN_BODY = '#ffcf3a'
const COIN_EDGE = '#c98a12'
const COIN_SHINE = '#fff6c2'
const SPARKLE_COLORS: readonly string[] = ['#ffffff', '#fff3a6', '#ffd1f0', '#bfe9ff']

const GRAVITY: readonly number[] = [260, 150, 0, 240, -14]
const DRAG: readonly number[] = [0, 2.2, 0, 0, 3]
const CONFETTI_MAX_FALL = 38

export class IsoParticles {
  readonly cap: number
  private n = 0
  private readonly x: Float32Array
  private readonly y: Float32Array
  private readonly vx: Float32Array
  private readonly vy: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly ph: Float32Array
  private readonly kind: Uint8Array
  private readonly color: Uint8Array

  constructor(
    cap = 800,
    readonly s = FX_SCALE,
    private readonly rand: () => number = Math.random,
  ) {
    this.cap = cap
    this.x = new Float32Array(cap)
    this.y = new Float32Array(cap)
    this.vx = new Float32Array(cap)
    this.vy = new Float32Array(cap)
    this.age = new Float32Array(cap)
    this.life = new Float32Array(cap)
    this.ph = new Float32Array(cap)
    this.kind = new Uint8Array(cap)
    this.color = new Uint8Array(cap)
  }

  get count(): number {
    return this.n
  }

  private spawn(kind: PK, x: number, y: number, vx: number, vy: number, life: number, color = 0): void {
    if (this.n >= this.cap) return
    const i = this.n++
    this.kind[i] = kind
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.age[i] = 0
    this.life[i] = Math.max(0.01, life)
    this.ph[i] = this.rand() * 6.283
    this.color[i] = color
  }

  popcorn(x: number, y: number): void {
    const s = this.s
    const r = this.rand
    const vy = -(62 + r() * 26)
    this.spawn(PK.Popcorn, x + (r() * 4 - 2) * s, y, (r() * 28 - 14) * s, vy * s, (-2 * vy) / GRAVITY[PK.Popcorn]! + 0.05)
  }

  confetti(x: number, y: number, count = 42): void {
    const s = this.s
    const r = this.rand
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.4
      const sp = (55 + r() * 70) * s
      this.spawn(PK.Confetti, x + (r() * 6 - 3) * s, y, Math.cos(a) * sp, Math.sin(a) * sp, 1.3 + r() * 0.9, Math.floor(r() * CONFETTI_COLORS.length))
    }
  }

  confettiFall(x: number, y: number, fall: number): void {
    const s = this.s
    const r = this.rand
    this.spawn(PK.Confetti, x, y, (r() * 24 - 12) * s, (8 + r() * 16) * s, Math.max(0.3, fall / (34 * s)) * (0.85 + r() * 0.3), Math.floor(r() * CONFETTI_COLORS.length))
  }

  rain(x: number, y: number, fall: number): void {
    const v = 32 * this.s
    this.spawn(PK.Rain, x, y, 0, v, Math.max(0.05, fall / v))
  }

  coins(x0: number, y0: number, x1: number, y1: number, count = 7): void {
    const s = this.s
    const r = this.rand
    const g = GRAVITY[PK.Coin]! * s
    for (let i = 0; i < count; i++) {
      const t = 0.55 + i * 0.07 + r() * 0.06
      const tx = x1 + (r() * 6 - 3) * s
      const ty = y1 + (r() * 3 - 1) * s
      const sx = x0 + (r() * 4 - 2) * s
      this.spawn(PK.Coin, sx, y0, (tx - sx) / t, (ty - y0) / t - 0.5 * g * t, t)
    }
  }

  sparkle(x: number, y: number, count = 9): void {
    const s = this.s
    const r = this.rand
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r() * 0.5
      const d = (5 + r() * 6) * s
      this.spawn(PK.Sparkle, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8 - 6 * s, Math.cos(a) * 6 * s, (-10 - r() * 8) * s, 0.8 + r() * 0.6, Math.floor(r() * SPARKLE_COLORS.length))
    }
  }

  update(dt: number): void {
    const d = Math.min(0.1, Math.max(0, dt))
    const s = this.s
    let i = 0
    while (i < this.n) {
      this.age[i]! += d
      if (this.age[i]! >= this.life[i]!) {
        this.remove(i)
        continue
      }
      const k = this.kind[i]!
      this.vy[i]! += GRAVITY[k]! * s * d
      if (DRAG[k]) this.vx[i]! *= Math.max(0, 1 - DRAG[k]! * d)
      if (k === PK.Confetti && this.vy[i]! > CONFETTI_MAX_FALL * s) this.vy[i] = CONFETTI_MAX_FALL * s
      this.x[i]! += this.vx[i]! * d
      this.y[i]! += this.vy[i]! * d
      i++
    }
  }

  draw(ctx: CanvasRenderingContext2D, vx0: number, vy0: number, vx1: number, vy1: number, now: number): void {
    if (!this.n) return
    const s = this.s
    const m = 4 * s
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i]!
      const y = this.y[i]!
      if (x < vx0 - m || x > vx1 + m || y < vy0 - m || y > vy1 + m) continue
      const k = this.kind[i]!
      const left = 1 - this.age[i]! / this.life[i]!
      const ph = this.ph[i]!
      if (k === PK.Popcorn) {
        ctx.globalAlpha = 1
        ctx.fillStyle = POPCORN_BODY
        ctx.beginPath()
        ctx.arc(x, y, 1.1 * s, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = POPCORN_SHADE
        ctx.beginPath()
        ctx.arc(x + 0.45 * s, y + 0.45 * s, 0.5 * s, 0, Math.PI * 2)
        ctx.fill()
      } else if (k === PK.Confetti) {
        ctx.globalAlpha = Math.min(1, left * 3.5)
        ctx.fillStyle = CONFETTI_COLORS[this.color[i]! % CONFETTI_COLORS.length]!
        const spin = Math.sin(now / 90 + ph)
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(ph + now / 400)
        ctx.fillRect(-s, -0.5 * s * Math.max(0.25, Math.abs(spin)), 2 * s, s * Math.max(0.25, Math.abs(spin)))
        ctx.restore()
      } else if (k === PK.Coin) {
        ctx.globalAlpha = 1
        const turn = Math.abs(Math.sin(now / 70 + ph))
        const rx = 1.5 * s * Math.max(0.25, turn)
        ctx.fillStyle = COIN_EDGE
        ctx.beginPath()
        ctx.ellipse(x, y, rx, 1.5 * s, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = COIN_BODY
        ctx.beginPath()
        ctx.ellipse(x - 0.2 * s, y - 0.2 * s, rx * 0.8, 1.2 * s, 0, 0, Math.PI * 2)
        ctx.fill()
        if (turn > 0.5) {
          ctx.fillStyle = COIN_SHINE
          ctx.beginPath()
          ctx.arc(x - 0.6 * s * turn, y - 0.6 * s, 0.4 * s, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (k === PK.Sparkle) {
        ctx.globalAlpha = Math.min(1, left * 2.5)
        ctx.fillStyle = SPARKLE_COLORS[this.color[i]! % SPARKLE_COLORS.length]!
        const r = (Math.sin(now / 90 + ph) > 0 ? 1.6 : 0.8) * s
        ctx.beginPath()
        ctx.moveTo(x, y - r)
        ctx.quadraticCurveTo(x, y, x + r, y)
        ctx.quadraticCurveTo(x, y, x, y + r)
        ctx.quadraticCurveTo(x, y, x - r, y)
        ctx.quadraticCurveTo(x, y, x, y - r)
        ctx.fill()
      } else {
        ctx.globalAlpha = 0.85
        ctx.strokeStyle = RAIN_COLOR
        ctx.lineWidth = 0.5 * s
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + 2 * s)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  clear(): void {
    this.n = 0
  }

  private remove(i: number): void {
    const j = --this.n
    if (i === j) return
    this.x[i] = this.x[j]!
    this.y[i] = this.y[j]!
    this.vx[i] = this.vx[j]!
    this.vy[i] = this.vy[j]!
    this.age[i] = this.age[j]!
    this.life[i] = this.life[j]!
    this.ph[i] = this.ph[j]!
    this.kind[i] = this.kind[j]!
    this.color[i] = this.color[j]!
  }
}
