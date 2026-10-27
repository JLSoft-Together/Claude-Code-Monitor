import { describe, expect, it } from 'vitest'
import { ambientAt, WHITE } from '@ccm/habblaud/client/src/world/render/daylight'
import { layoutCafe, layoutReception } from '@ccm/habblaud/client/src/world/layout/core'
import { areaTint, convexHull, darkTint, floorRect, prismHull, presenceLit, roomDark, TINT_SOFT } from './light'
import { makeIsoView } from './projection'

describe('iso lighting', () => {
  it('day is neutral, night tints rooms warm, empty common areas dim and the corridor in between', () => {
    const day = ambientAt(13)
    expect(areaTint(day, { room: true, kind: 'room', lit: 1, cover: 1 })).toEqual(WHITE)
    const night = ambientAt(23)
    const lit = areaTint(night, { room: true, kind: 'room', lit: 1, cover: 1 })
    expect(lit[2]).toBeLessThan(255)
    expect(lit[0]).toBeGreaterThan(lit[2])
    const off = areaTint(night, { room: true, kind: 'room', lit: 0, cover: 1 })
    expect(off).toEqual(WHITE)
    const emptyCafe = areaTint(night, { room: false, kind: 'cafe', lit: 0, cover: 1 })
    const busyCafe = areaTint(night, { room: false, kind: 'cafe', lit: 1, cover: 1 })
    expect(emptyCafe[0]).toBeLessThan(busyCafe[0])
    const hall = areaTint(night, { room: false, kind: 'corridor', lit: 1, cover: 1 })
    expect(hall[0]).toBeLessThanOrEqual(busyCafe[0])
    expect(hall[0]).toBeGreaterThanOrEqual(emptyCafe[0])
    const soft = areaTint(night, { room: false, kind: 'reception', lit: 1, cover: 1 })
    expect(soft[2]).toBe(Math.round(255 + (night.inside[2] - 255) * TINT_SOFT))
    expect(presenceLit('restroom')).toBe(true)
    expect(presenceLit('reception')).toBe(false)
  })

  it('rooms being built fade from the outside tone', () => {
    const night = ambientAt(23)
    const half = areaTint(night, { room: true, kind: 'room', lit: 1, cover: 0.5 })
    const full = areaTint(night, { room: true, kind: 'room', lit: 1, cover: 1 })
    expect(half[2]).toBeLessThan(full[2])
  })

  it('dark rooms multiply toward the night ink, stronger at night, weaker while building', () => {
    expect(darkTint(WHITE, 0)).toEqual(WHITE)
    const d = darkTint(WHITE, 0.74)
    expect(d[0]).toBeLessThan(80)
    expect(d[2]).toBeGreaterThan(d[0])
    expect(roomDark('ready', 0, 1, 1)).toBeCloseTo(0.84)
    expect(roomDark('ready', 0, 0, 1)).toBeCloseTo(0.74)
    expect(roomDark('building', 0, 0, 1)).toBeCloseTo(0.5)
    expect(roomDark('ready', 1, 1, 1)).toBe(0)
    expect(roomDark('ready', 0, 0, 0.5)).toBeCloseTo(0.37)
  })

  it('the room prism at the front view is the floor plus the wall band above it', () => {
    const view = makeIsoView({ yaw: 0, k: 0.7 })
    const hull = prismHull(view, 0, 32, 64, 96, 60)
    expect(hull).toHaveLength(4)
    const ys = hull.map((p) => p.y)
    expect(Math.min(...ys)).toBeCloseTo(32 * 1.4 - 60)
    expect(Math.max(...ys)).toBeCloseTo(96 * 1.4)
    const xs = hull.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(0)
    expect(Math.max(...xs)).toBeCloseTo(128)
    const tilted = prismHull(makeIsoView({ yaw: 30, k: 0.6 }), 0, 0, 64, 64, 40)
    expect(tilted.length).toBe(6)
    expect(convexHull([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toHaveLength(2)
  })

  it('the lit floor starts under the north face wall of an area', () => {
    const cafe = layoutCafe()
    const f = floorRect({ layout: cafe })
    expect(f.x0).toBe(cafe.rect.x * 16)
    expect(f.y1).toBe((cafe.rect.y + cafe.rect.h) * 16)
    expect(f.y0).toBeGreaterThan(cafe.rect.y * 16)
    const rec = layoutReception()
    expect(floorRect({ layout: rec }).y0).toBeGreaterThanOrEqual(rec.rect.y * 16)
  })
})
