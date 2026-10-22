import type { WallStyle } from '@ccm/habblaud/client/src/art/api'
import type { WallSegment } from '@ccm/habblaud/client/src/world/layout/types'
import type { DepthBox } from './depth'
import { TILE, WALL_H, type IsoView } from './projection'

export const LOW_H = 7
export const XRAY_ALPHA = 0.35

export interface FacePiece {
  kind: 'face'
  x0: number
  x1: number
  top: number
  baseY: number
  height: number
  box: DepthBox
  base: string
  style: WallStyle
}

export interface LowPiece {
  kind: 'low'
  box: DepthBox
  height: number
  base: string
  style: WallStyle
}

export type WallPiece = FacePiece | LowPiece

function spans(x0: number, x1: number, doorways: readonly { x: number; w: number }[] | undefined): [number, number][] {
  const out: [number, number][] = []
  let cur = x0
  for (const d of [...(doorways ?? [])].sort((a, b) => a.x - b.x)) {
    if (d.x > cur) out.push([cur, Math.min(d.x, x1)])
    cur = Math.max(cur, d.x + d.w)
  }
  if (cur < x1) out.push([cur, x1])
  return out.filter(([a, b]) => b - a >= 1)
}

export function wallPieces(walls: readonly WallSegment[]): WallPiece[] {
  const faces = walls.filter((w) => w.kind === 'face')
  const out: WallPiece[] = []
  for (const w of walls) {
    if (w.kind === 'face') {
      const baseY = w.y + 2 * TILE
      for (const [a, b] of spans(w.x, w.x + w.w, w.doorways)) {
        out.push({ kind: 'face', x0: a, x1: b, top: w.y, baseY, height: WALL_H, box: { minX: a, maxX: b, minY: baseY - 2, maxY: baseY }, base: w.style.base, style: w.style })
      }
    } else if (w.kind === 'south') {
      for (const [a, b] of spans(w.x, w.x + w.w, w.doorways)) {
        out.push({ kind: 'low', box: { minX: a, maxX: b, minY: w.y + 4, maxY: w.y + 12 }, height: LOW_H, base: w.style.base, style: w.style })
      }
    } else {
      const face = faces.find((f) => f.y === w.y && w.x + w.w >= f.x - 1 && w.x <= f.x + f.w + 1)
      const y0 = face ? w.y + 2 * TILE : w.y
      if (w.y + w.h - y0 < 1) continue
      out.push({ kind: 'low', box: { minX: w.x, maxX: w.x + w.w, minY: y0, maxY: w.y + w.h }, height: LOW_H, base: w.style.base, style: w.style })
    }
  }
  return out
}

export function coversPoint(p: FacePiece, vx: number, vy: number, view: IsoView): boolean {
  const { x: px, groundY: ground } = view.facePointAt(p.baseY, vx)
  if (px < p.x0 || px > p.x1) return false
  return vy <= ground && vy >= ground - p.height
}
