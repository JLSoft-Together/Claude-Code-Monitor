import { TILE } from '@ccm/habblaud/client/src/art/api'
import { BUILDING_H, COL_W } from '@ccm/habblaud/client/src/world/constants'
import { buildAnim } from '@ccm/habblaud/client/src/world/render/anim'
import { isNeutral, mixRgb, rgbCss, WHITE, type Ambient, type Rgb } from '@ccm/habblaud/client/src/world/render/daylight'
import type { AreaVis } from '@ccm/habblaud/client/src/world/render/scene'
import type { Sim } from '@ccm/habblaud/client/src/world/sim/sim'
import { softGlow } from './effects'
import { WALL_H, type IsoView } from './projection'

export const LIGHT_MAP_SCALE = 4
export const TINT_SOFT = 0.9
export const DARK_INK: Rgb = [8, 12, 36]
export const PRISM_TOP = WALL_H + 12
export const LAMP_POOL = 84
export const MACHINE_POOL = 46
const OCCUPANCY_MS = 250
const LAMP_WARM: Rgb = [255, 236, 196]
const SCREEN_COOL: Rgb = [196, 222, 255]
const ARCADE_GLOW: Rgb = [236, 190, 255]

export interface Pt {
  x: number
  y: number
}

export function presenceLit(kind: string): boolean {
  return kind === 'cafe' || kind === 'lounge' || kind === 'restroom'
}

export function areaTint(amb: Ambient, a: { room: boolean; kind: string; lit: number; cover: number }): Rgb {
  let c: Rgb
  if (a.room) c = mixRgb(WHITE, amb.inside, a.lit)
  else if (a.kind === 'corridor') c = mixRgb(amb.inside, amb.dim, 0.18)
  else if (presenceLit(a.kind)) c = mixRgb(amb.dim, amb.inside, a.lit)
  else c = amb.inside
  const base = a.cover >= 1 ? c : mixRgb(amb.outside, c, a.cover)
  return mixRgb(WHITE, base, TINT_SOFT)
}

export function darkTint(base: Rgb, dark: number): Rgb {
  const ink: Rgb = [Math.round((base[0] * DARK_INK[0]) / 255), Math.round((base[1] * DARK_INK[1]) / 255), Math.round((base[2] * DARK_INK[2]) / 255)]
  return mixRgb(base, ink, dark)
}

export function roomDark(phase: string, light: number, night: number, cover: number): number {
  const strength = (phase === 'building' ? 0.5 : 0.74) + 0.1 * night
  return Math.max(0, Math.min(1, (1 - light) * strength * cover))
}

export function convexHull(pts: readonly Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop()
    upper.push(q)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

export function prismHull(view: Pick<IsoView, 'toView'>, x0: number, y0: number, x1: number, y1: number, h: number): Pt[] {
  const pts: Pt[] = []
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [0, h]) pts.push(view.toView(x, y, z))
  return convexHull(pts)
}

export function floorRect(vis: Pick<AreaVis, 'layout'>): { x0: number; y0: number; x1: number; y1: number } {
  const r = vis.layout.rect
  let base = r.y * TILE
  const faces = vis.layout.walls.filter((w) => w.kind === 'face')
  if (faces.length) base = Math.min(...faces.map((w) => w.y + 2 * TILE))
  return { x0: r.x * TILE, y0: base, x1: (r.x + r.w) * TILE, y1: (r.y + r.h) * TILE }
}

const beams = new Map<string, HTMLCanvasElement | null>()

export function beamSprite(c: Rgb): HTMLCanvasElement | null {
  const key = c.join(',')
  const hit = beams.get(key)
  if (hit !== undefined) return hit
  let s: HTMLCanvasElement | null = null
  try {
    s = document.createElement('canvas')
    s.width = 16
    s.height = 64
    const g = s.getContext('2d')
    if (g) {
      const grad = g.createLinearGradient(0, 0, 0, 64)
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.85)`)
      grad.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},0.45)`)
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
      g.fillStyle = grad
      g.fillRect(0, 0, 16, 64)
      const edge = g.createLinearGradient(0, 0, 16, 0)
      edge.addColorStop(0, 'rgba(0,0,0,1)')
      edge.addColorStop(0.25, 'rgba(0,0,0,0)')
      edge.addColorStop(0.75, 'rgba(0,0,0,0)')
      edge.addColorStop(1, 'rgba(0,0,0,1)')
      g.globalCompositeOperation = 'destination-out'
      g.fillStyle = edge
      g.fillRect(0, 0, 16, 64)
    } else s = null
  } catch {
    s = null
  }
  beams.set(key, s)
  return s
}

interface AreaLight {
  lit: number
  cover: number
  dark: number
}

export class IsoLight {
  private map: HTMLCanvasElement | null = null
  private m: CanvasRenderingContext2D | null = null
  private failed = false
  private key = ''
  private mx = 0
  private my = 0
  private coreLevel = new Map<string, number>()
  private coreBusy = new Map<string, boolean>()
  private occAt = -Infinity
  private vignette: HTMLCanvasElement | null = null

  constructor(
    private readonly view: IsoView,
    private readonly sim: Sim,
  ) {}

  level(vis: AreaVis): number {
    return this.coreLevel.get(vis.id) ?? 0
  }

  areaLight(vis: AreaVis, now: number, night: number): AreaLight {
    const room = vis.room
    if (room) {
      const cover = room.phase === 'building' || room.phase === 'dismantling' ? buildAnim(room.phase, room.progress(now)).floor : 1
      const light = room.light(now)
      return { lit: light, cover, dark: vis.layout.shade ? roomDark(room.phase, light, night, cover) : 0 }
    }
    if (presenceLit(vis.layout.kind)) return { lit: this.coreLevel.get(vis.id) ?? 0, cover: 1, dark: 0 }
    return { lit: 1, cover: 1, dark: 0 }
  }

  updateOccupancy(areas: Iterable<AreaVis>, now: number, dt: number, reduced: boolean): void {
    if (now - this.occAt >= OCCUPANCY_MS) {
      this.occAt = now
      for (const vis of areas) {
        if (vis.room || !presenceLit(vis.layout.kind)) continue
        const r = vis.layout.rect
        let busy = false
        for (const c of this.sim.chars.values()) {
          if (c.gone || c.inside) continue
          if (c.tx >= r.x && c.ty >= r.y && c.tx < r.x + r.w && c.ty < r.y + r.h) {
            busy = true
            break
          }
        }
        this.coreBusy.set(vis.id, busy)
      }
    }
    const k = reduced ? 1 : Math.min(1, dt * 3.5)
    for (const [id, busy] of this.coreBusy) {
      const want = busy ? 1 : 0
      const cur = this.coreLevel.get(id) ?? want
      this.coreLevel.set(id, Math.abs(want - cur) < 0.02 ? want : cur + (want - cur) * k)
    }
  }

  draw(ctx: CanvasRenderingContext2D, amb: Ambient, areas: readonly AreaVis[], now: number): void {
    const lights = areas.map((vis) => this.areaLight(vis, now, amb.night))
    const neutral = isNeutral(amb)
    if (neutral && lights.every((l) => l.dark <= 0.01)) return
    const map = this.ensureMap()
    if (!map || !this.m) return
    let key = `${Math.round(amb.night * 200)}|${amb.outside.join(',')}|${amb.inside.join(',')}|${amb.dim.join(',')}|${this.sim.building.cols}`
    areas.forEach((vis, i) => {
      const l = lights[i]!
      key += `|${vis.id}:${Math.round(l.lit * 24)}:${Math.round(l.cover * 20)}:${Math.round(l.dark * 40)}:${vis.room?.lightOn ? 1 : 0}`
    })
    if (key !== this.key) {
      this.key = key
      this.paint(this.m, amb, areas, lights)
    }
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(map, this.mx, this.my, map.width * LIGHT_MAP_SCALE, map.height * LIGHT_MAP_SCALE)
    ctx.restore()
  }

  private bounds(): { x: number; y: number; w: number; h: number } {
    const w = this.sim.building.cols * COL_W * TILE
    const h = BUILDING_H * TILE
    return this.view.bounds({ x: -2 * TILE, y: -2 * TILE, w: w + 4 * TILE, h: h + 4 * TILE }, PRISM_TOP)
  }

  private ensureMap(): HTMLCanvasElement | null {
    if (this.failed) return null
    const b = this.bounds()
    const w = Math.max(1, Math.ceil(b.w / LIGHT_MAP_SCALE))
    const h = Math.max(1, Math.ceil(b.h / LIGHT_MAP_SCALE))
    if (!this.map || this.map.width !== w || this.map.height !== h) {
      try {
        if (!this.map) this.map = document.createElement('canvas')
        this.map.width = w
        this.map.height = h
        this.m = this.map.getContext('2d')
      } catch {
        this.m = null
      }
      if (!this.m) {
        this.failed = true
        return null
      }
      this.key = ''
    }
    this.mx = b.x
    this.my = b.y
    return this.map
  }

  private vignetteSprite(): HTMLCanvasElement | null {
    if (this.vignette) return this.vignette
    try {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const g = c.getContext('2d')
      if (!g) return null
      const grad = g.createRadialGradient(32, 29, 0, 32, 29, 40)
      grad.addColorStop(0, 'rgb(255,255,255)')
      grad.addColorStop(0.5, 'rgb(252,249,244)')
      grad.addColorStop(1, 'rgb(222,208,192)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 64)
      this.vignette = c
    } catch {
      this.vignette = null
    }
    return this.vignette
  }

  private paint(m: CanvasRenderingContext2D, amb: Ambient, areas: readonly AreaVis[], lights: readonly AreaLight[]): void {
    const S = LIGHT_MAP_SCALE
    const base: [number, number, number, number, number, number] = [1 / S, 0, 0, 1 / S, -this.mx / S, -this.my / S]
    m.setTransform(1, 0, 0, 1, 0, 0)
    m.globalCompositeOperation = 'source-over'
    m.globalAlpha = 1
    m.fillStyle = rgbCss(mixRgb(WHITE, amb.outside, TINT_SOFT))
    m.fillRect(0, 0, this.map!.width, this.map!.height)
    m.setTransform(...base)
    const order = areas.map((vis, i) => ({ vis, l: lights[i]! })).sort((a, b) => a.vis.layout.rect.y - b.vis.layout.rect.y || a.vis.layout.rect.x - b.vis.layout.rect.x)
    for (const { vis, l } of order) {
      if (l.cover <= 0.01) continue
      const f = floorRect(vis)
      const tint = darkTint(areaTint(amb, { room: !!vis.room, kind: vis.layout.kind, lit: l.lit, cover: l.cover }), l.dark)
      const hull = prismHull(this.view, f.x0, f.y0, f.x1, f.y1, PRISM_TOP)
      m.fillStyle = rgbCss(tint)
      m.beginPath()
      hull.forEach((p, i) => (i ? m.lineTo(p.x, p.y) : m.moveTo(p.x, p.y)))
      m.closePath()
      m.fill()
      const glow = (vis.room ? l.lit : presenceLit(vis.layout.kind) ? l.lit : vis.layout.kind === 'corridor' ? 0 : 1) * l.cover * amb.night
      const vig = glow > 0.05 ? this.vignetteSprite() : null
      if (vig) {
        m.save()
        m.transform(...this.view.ground)
        m.globalCompositeOperation = 'multiply'
        m.globalAlpha = Math.min(1, glow)
        m.drawImage(vig, f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0)
        m.restore()
      }
    }
    const n = amb.night
    if (n >= 0.12) {
      const k = Math.min(1, (n - 0.12) / 0.5)
      const lamp = softGlow(LAMP_WARM, 64, 1)
      const cool = softGlow(SCREEN_COOL, 48, 1)
      const arcade = softGlow(ARCADE_GLOW, 48, 1)
      m.save()
      m.transform(...this.view.ground)
      m.globalCompositeOperation = 'lighten'
      for (const { vis, l } of order) {
        const on = vis.room ? vis.room.lightOn && l.lit >= 0.3 : true
        if (!on || l.cover < 1) continue
        const a = vis.room ? k * l.lit : k
        for (const f of vis.furniture) {
          const img = f.kind === 'floor_lamp' ? lamp : f.kind === 'vending_machine' ? cool : f.kind === 'arcade' ? arcade : null
          if (!img) continue
          const size = f.kind === 'floor_lamp' ? LAMP_POOL : MACHINE_POOL
          m.globalAlpha = Math.min(1, (f.kind === 'floor_lamp' ? 1 : 0.85) * a)
          m.drawImage(img, f.ax - size / 2, f.ay - TILE / 2 - size / 2, size, size)
        }
      }
      m.restore()
    }
    m.setTransform(1, 0, 0, 1, 0, 0)
    m.globalAlpha = 1
    m.globalCompositeOperation = 'source-over'
  }
}
