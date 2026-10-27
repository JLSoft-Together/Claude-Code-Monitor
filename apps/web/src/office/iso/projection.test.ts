import { describe, expect, it } from 'vitest'
import { CLASSIC_ISO, DEFAULT_ISO, ISO_VIEW_KEY, isoProjection, makeIsoView, readIsoParams, validIsoParams, WALL_H, WALL_HK } from './projection'

function apply(m: readonly number[], x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number]
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

const classic = makeIsoView(CLASSIC_ISO)
const VIEWS = [CLASSIC_ISO, { yaw: 30, k: 0.5 }, { yaw: 22, k: 0.55 }, { yaw: 15, k: 0.6 }, { yaw: 8, k: 0.6 }, { yaw: 70, k: 0.4 }, { yaw: 0, k: 0.6 }, { yaw: 0, k: 0.7 }, { yaw: 0, k: 0.75 }]

describe('iso projection at yaw 45 / k 0.5 (classic 2:1)', () => {
  it('maps one tile to a 32x16 diamond', () => {
    expect(classic.toView(16, 0)).toEqual({ x: 16, y: 8 })
    expect(classic.toView(0, 16)).toEqual({ x: -16, y: 8 })
    expect(classic.toView(16, 16)).toEqual({ x: 0, y: 16 })
    expect(classic.toView(0, 0, 10)).toEqual({ x: 0, y: -10 })
  })

  it('matches the old closed forms exactly', () => {
    for (const [x, y, h] of [
      [0, 0, 0],
      [37.5, 12, 3],
      [-80, 400, 48],
      [1234, 5678, 7],
    ] as const) {
      expect(classic.toView(x, y, h)).toEqual({ x: x - y, y: (x + y) / 2 - h })
      const w = classic.toWorld(x, y)
      expect(w).toEqual({ x: y + x / 2, y: y - x / 2 })
    }
    expect(classic.ground).toEqual([1, 0.5, -1, 0.5, 0, 0])
    expect(classic.wallMatrix(64)).toEqual([1, 0.5, 0, WALL_HK, -64, 64 / 2 - 64 * WALL_HK])
    expect(classic.depthW).toEqual([1, 1])
  })

  it('bounds keep the old values', () => {
    expect(classic.bounds({ x: 32, y: 48, w: 256, h: 192 }, WALL_H)).toEqual({ x: 32 - 240, y: 40 - WALL_H, w: 448, h: 224 + WALL_H })
  })
})

describe.each(VIEWS)('iso projection yaw $yaw k $k', (params) => {
  const v = makeIsoView(params)

  it('round-trips ground points', () => {
    for (const [x, y] of [
      [0, 0],
      [37.5, 12],
      [-80, 400],
      [1234, 5678],
    ] as const) {
      const p = v.toView(x, y)
      const w = v.toWorld(p.x, p.y)
      expect(w.x).toBeCloseTo(x, 6)
      expect(w.y).toBeCloseTo(y, 6)
    }
  })

  it('a tile is 32 px wide and depth grows toward +x+y', () => {
    const b = v.bounds({ x: 0, y: 0, w: 16, h: 16 })
    expect(b.w).toBeCloseTo(32, 6)
    expect(v.ax.y).toBeGreaterThanOrEqual(0)
    expect(v.ay.y).toBeGreaterThan(0)
    expect(v.depthW[0]).toBeGreaterThanOrEqual(0)
    expect(v.depthW[1]).toBeGreaterThan(0)
  })

  it('the view direction projects to a single point', () => {
    const [dx, dy, dh] = v.viewDir
    const a = v.toView(40, 70, 5)
    const b = v.toView(40 + 30 * dx, 70 + 30 * dy, 5 + 30 * dh)
    expect(b.x).toBeCloseTo(a.x, 6)
    expect(b.y).toBeCloseTo(a.y, 6)
  })

  it('bounds cover every projected corner, raised by the height', () => {
    const r = { x: 32, y: 48, w: 256, h: 192 }
    const b = v.bounds(r, WALL_H)
    for (const p of v.roomOutline(r)) {
      expect(p.x).toBeGreaterThanOrEqual(b.x - 1e-9)
      expect(p.x).toBeLessThanOrEqual(b.x + b.w + 1e-9)
      expect(p.y).toBeLessThanOrEqual(b.y + b.h + 1e-9)
      expect(p.y - WALL_H).toBeGreaterThanOrEqual(b.y - 1e-9)
    }
  })

  it('ground matrix equals toView', () => {
    const g = apply(v.ground, 40, 24)
    const t = v.toView(40, 24)
    expect(g.x).toBeCloseTo(t.x, 9)
    expect(g.y).toBeCloseTo(t.y, 9)
  })

  it('north wall matrix keeps the base on the ground and lifts the top by the wall height', () => {
    const baseY = 64
    const m = v.wallMatrix(baseY)
    const g = apply(m, 100, baseY)
    expect(g.x).toBeCloseTo(v.toView(100, baseY).x)
    expect(g.y).toBeCloseTo(v.toView(100, baseY).y)
    const top = apply(m, 100, baseY - 32)
    expect(top.x).toBeCloseTo(v.toView(100, baseY, WALL_H).x)
    expect(top.y).toBeCloseTo(v.toView(100, baseY, WALL_H).y)
  })

  it('side wall matrix runs along y at a fixed x', () => {
    const m = v.sideWallMatrix(48, 32)
    const g = apply(m, 90, 32)
    expect(g.x).toBeCloseTo(v.toView(48, 90).x)
    expect(g.y).toBeCloseTo(v.toView(48, 90).y)
    const top = apply(m, 90, 0)
    expect(top.y).toBeCloseTo(v.toView(48, 90, WALL_H).y)
  })

  it('facePointAt inverts a point on a north wall', () => {
    const p = v.toView(77, 32, 20)
    const f = v.facePointAt(32, p.x)
    expect(f.x).toBeCloseTo(77, 6)
    expect(f.groundY - 20).toBeCloseTo(p.y, 6)
  })
})

describe('front 3/4 view (yaw 0)', () => {
  const v = makeIsoView({ yaw: 0, k: 0.7 })

  it('lays the long x axis flat and squashes y by k', () => {
    expect(v.ax).toEqual({ x: 2, y: 0 })
    expect(v.ay).toEqual({ x: 0, y: 1.4 })
    expect(v.ground).toEqual([2, 0, 0, 1.4, 0, 0])
    expect(v.toView(16, 16, 10)).toEqual({ x: 32, y: 16 * 1.4 - 10 })
    expect(v.depthW).toEqual([0, Math.round(Math.SQRT2 * 1e9) / 1e9])
  })

  it('shows north walls face on and side walls edge on', () => {
    expect(v.wallMatrix(64)).toEqual([2, 0, 0, WALL_HK, 0, 1.4 * 64 - WALL_HK * 64])
    const side = v.sideWallMatrix(48, 32)
    expect(side[0]).toBe(0)
    expect(apply(side, 10, 32).x).toBe(apply(side, 200, 0).x)
  })

  it('the fitted building covers more of a 16:9 frame than the classic diamond', () => {
    const r = { x: 0, y: 0, w: 96 * 16, h: 29 * 16 }
    const cover = (view: typeof v) => {
      const b = view.bounds(r, WALL_H)
      const z = Math.min(1600 / b.w, 900 / b.h)
      const det = view.ax.x * view.ay.y - view.ay.x * view.ax.y
      return (r.w * r.h * det * z * z) / (1600 * 900)
    }
    expect(cover(v)).toBeGreaterThan(cover(classic) * 1.1)
  })
})

describe('iso view override', () => {
  it('validates the stored value and falls back to the default', () => {
    const store = (v: string | null) => ({ getItem: (k: string) => (k === ISO_VIEW_KEY ? v : null) })
    expect(readIsoParams(store(null))).toEqual(DEFAULT_ISO)
    expect(readIsoParams(store('{"yaw":25,"k":0.55}'))).toEqual({ yaw: 25, k: 0.55 })
    expect(readIsoParams(store('{"yaw":95,"k":0.55}'))).toEqual(DEFAULT_ISO)
    expect(readIsoParams(store('{"yaw":25,"k":2}'))).toEqual(DEFAULT_ISO)
    expect(readIsoParams(store('{"yaw":"25","k":0.5}'))).toEqual(DEFAULT_ISO)
    expect(readIsoParams(store('not json'))).toEqual(DEFAULT_ISO)
    expect(readIsoParams(null)).toEqual(DEFAULT_ISO)
    expect(
      readIsoParams({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toEqual(DEFAULT_ISO)
    expect(validIsoParams({ yaw: -1, k: 0.5 })).toBeNull()
    expect(makeIsoView({ yaw: -1, k: 0.5 }).params).toEqual(DEFAULT_ISO)
    expect(readIsoParams(store('{"yaw":0,"k":0.6}'))).toEqual({ yaw: 0, k: 0.6 })
  })

  it('exposes the habblaud Projection shape with the default view', () => {
    expect(isoProjection.params).toEqual(DEFAULT_ISO)
    expect(isoProjection.roomOutline).toBeTypeOf('function')
    expect(isoProjection.toWorld).toBeTypeOf('function')
  })
})
