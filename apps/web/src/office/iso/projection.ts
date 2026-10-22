import type { Projection, ViewPoint, ViewRect } from '@ccm/habblaud/client/src/world'

export const TILE = 16
export const WALL_H = 48
export const WALL_HK = WALL_H / (2 * TILE)

export type Matrix = readonly [number, number, number, number, number, number]

export interface IsoParams {
  yaw: number
  k: number
}

export const CLASSIC_ISO: IsoParams = { yaw: 45, k: 0.5 }
export const DEFAULT_ISO: IsoParams = { yaw: 0, k: 0.7 }
export const ISO_VIEW_KEY = 'ccm.office.isoView'
export const YAW_RANGE = [0, 89] as const
export const K_RANGE = [0.3, 0.9] as const

export interface IsoView extends Projection {
  readonly params: IsoParams
  readonly ax: ViewPoint
  readonly ay: ViewPoint
  readonly ground: Matrix
  readonly depthW: readonly [number, number]
  readonly viewDir: readonly [number, number, number]
  toView(x: number, y: number, h?: number): ViewPoint
  toWorld(vx: number, vy: number): ViewPoint
  bounds(r: ViewRect, h?: number): ViewRect
  roomOutline(r: ViewRect): ViewPoint[]
  wallMatrix(baseY: number, hk?: number): Matrix
  sideWallMatrix(baseX: number, baseV: number, hk?: number): Matrix
  facePointAt(baseY: number, vx: number): { x: number; groundY: number }
}

const snap = (v: number) => {
  const r = Math.round(v * 1e9) / 1e9
  return r === 0 ? 0 : r
}

export function validIsoParams(v: unknown): IsoParams | null {
  if (!v || typeof v !== 'object') return null
  const { yaw, k } = v as Record<string, unknown>
  if (typeof yaw !== 'number' || typeof k !== 'number' || !Number.isFinite(yaw) || !Number.isFinite(k)) return null
  if (yaw < YAW_RANGE[0] || yaw > YAW_RANGE[1] || k < K_RANGE[0] || k > K_RANGE[1]) return null
  return { yaw, k }
}

export function readIsoParams(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): IsoParams {
  try {
    const raw = storage?.getItem(ISO_VIEW_KEY)
    if (!raw) return DEFAULT_ISO
    return validIsoParams(JSON.parse(raw)) ?? DEFAULT_ISO
  } catch {
    return DEFAULT_ISO
  }
}

export function makeIsoView(params: IsoParams = DEFAULT_ISO): IsoView {
  const p = validIsoParams(params) ?? DEFAULT_ISO
  const t = (p.yaw * Math.PI) / 180
  const c = Math.cos(t)
  const s0 = Math.sin(t)
  const s = 2 / (c + s0)
  const ax = { x: snap(c * s), y: snap(p.k * s0 * s) }
  const ay = { x: snap(-s0 * s), y: snap(p.k * c * s) }
  const det = ax.x * ay.y - ay.x * ax.y
  const toView = (x: number, y: number, h = 0): ViewPoint => ({ x: ax.x * x + ay.x * y, y: ax.y * x + ay.y * y - h })
  const toWorld = (vx: number, vy: number): ViewPoint => ({ x: (ay.y * vx - ay.x * vy) / det, y: (ax.x * vy - ax.y * vx) / det })
  const roomOutline = (r: ViewRect): ViewPoint[] => [toView(r.x, r.y), toView(r.x + r.w, r.y), toView(r.x + r.w, r.y + r.h), toView(r.x, r.y + r.h)]
  const bounds = (r: ViewRect, h = 0): ViewRect => {
    const pts = roomOutline(r)
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const q of pts) {
      x0 = Math.min(x0, q.x)
      x1 = Math.max(x1, q.x)
      y0 = Math.min(y0, q.y)
      y1 = Math.max(y1, q.y)
    }
    return { x: x0, y: y0 - h, w: x1 - x0, h: y1 - y0 + h }
  }
  const wallMatrix = (baseY: number, hk = WALL_HK): Matrix => [ax.x, ax.y, 0, hk, ay.x * baseY, ay.y * baseY - hk * baseY]
  const sideWallMatrix = (baseX: number, baseV: number, hk = WALL_HK): Matrix => [ay.x, ay.y, 0, hk, ax.x * baseX, ax.y * baseX - hk * baseV]
  const facePointAt = (baseY: number, vx: number) => {
    const x = (vx - ay.x * baseY) / ax.x
    return { x, groundY: ax.y * x + ay.y * baseY }
  }
  return {
    params: p,
    ax,
    ay,
    ground: [ax.x, ax.y, ay.x, ay.y, 0, 0],
    depthW: [snap(Math.SQRT2 * s0), snap(Math.SQRT2 * c)],
    viewDir: [s0, c, p.k * s],
    toView,
    toWorld,
    bounds,
    roomOutline,
    wallMatrix,
    sideWallMatrix,
    facePointAt,
  }
}

export const isoProjection: IsoView = makeIsoView(readIsoParams())
