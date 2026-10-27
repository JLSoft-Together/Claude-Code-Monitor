import { describe, expect, it } from 'vitest'
import type { WallSegment } from '@ccm/habblaud/client/src/world/layout/types'
import { coversPoint, LOW_H, wallPieces, type FacePiece } from './walls'
import { CLASSIC_ISO, makeIsoView, WALL_H } from './projection'

const style = { base: '#ddd' }

describe('3/4 walls to iso pieces', () => {
  const room: WallSegment[] = [
    { kind: 'face', x: 8, y: 0, w: 240, style, doorways: [{ x: 112, w: 32 }] },
    { kind: 'south', x: 8, y: 176, w: 240, style },
    { kind: 'cap', x: 0, y: 0, w: 8, h: 192, style },
  ]
  const pieces = wallPieces(room)

  it('a north face becomes a thin wall at the bottom of the face rows, split at the door', () => {
    const faces = pieces.filter((p): p is FacePiece => p.kind === 'face')
    expect(faces.map((f) => [f.x0, f.x1])).toEqual([
      [8, 112],
      [144, 248],
    ])
    expect(faces[0]!.baseY).toBe(32)
    expect(faces[0]!.height).toBe(WALL_H)
  })

  it('the mureta and the caps become low boxes; caps start below the face rows', () => {
    const low = pieces.filter((p) => p.kind === 'low')
    expect(low).toHaveLength(2)
    expect(low.every((p) => p.height === LOW_H)).toBe(true)
    expect(low[1]!.box).toEqual({ minX: 0, maxX: 8, minY: 32, maxY: 192 })
  })

  it.each([CLASSIC_ISO, { yaw: 30, k: 0.5 }, { yaw: 20, k: 0.55 }, { yaw: 8, k: 0.6 }, { yaw: 0, k: 0.7 }])('coversPoint is true inside the projected wall face only (yaw $yaw, k $k)', (params) => {
    const view = makeIsoView(params)
    const f = pieces[0] as FacePiece
    const mid = view.toView(60, 32, WALL_H / 2)
    expect(coversPoint(f, mid.x, mid.y, view)).toBe(true)
    const above = view.toView(60, 32, WALL_H + 4)
    expect(coversPoint(f, above.x, above.y, view)).toBe(false)
    const door = view.toView(128, 32, 10)
    expect(coversPoint(f, door.x, door.y, view)).toBe(false)
  })
})
