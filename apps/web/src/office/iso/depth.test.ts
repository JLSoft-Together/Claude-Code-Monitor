import { describe, expect, it } from 'vitest'
import { behind, compareDepth, insertRank, topoSort, type DepthBox, type Placed } from './depth'
import { CLASSIC_ISO, makeIsoView, type IsoView } from './projection'

const classic = makeIsoView(CLASSIC_ISO)

const LAMBDAS = Array.from({ length: 60 }, (_, i) => (i < 30 ? -(i + 1) * 2 : (i - 29) * 2))

function box(minX: number, minY: number, maxX: number, maxY: number): DepthBox {
  return { minX, minY, maxX, maxY }
}

function item(name: string, b: DepthBox, h = 20, view: IsoView = classic) {
  const s = view.bounds({ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }, h)
  return { name, box: b, screen: { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h } }
}

describe('iso depth rule', () => {
  it('A is behind B when it ends before B on x or on y', () => {
    expect(behind(box(0, 0, 16, 16), box(16, 0, 32, 16))).toBe(true)
    expect(behind(box(0, 0, 16, 16), box(0, 16, 16, 32))).toBe(true)
    expect(behind(box(16, 0, 32, 16), box(0, 0, 16, 16))).toBe(false)
  })

  it('overlapping boxes tie on the centre sum', () => {
    expect(compareDepth(box(0, 0, 32, 32), box(8, 8, 24, 24))).toBe(0)
    expect(compareDepth(box(0, 0, 32, 32), box(10, 10, 40, 40))).toBeLessThan(0)
  })

  it('a long thin north wall sorts before furniture in its room, a mureta after it', () => {
    const wall = item('wall', box(8, 30, 248, 32), 48)
    const desk = item('desk', box(64, 64, 96, 80), 12)
    const mureta = item('mureta', box(8, 180, 248, 188), 7)
    const order = topoSort([mureta, desk, wall]).map((i) => i.name)
    expect(order).toEqual(['wall', 'desk', 'mureta'])
  })

  it('a desk south of its chair draws over the chair; north of it, under', () => {
    const chair = item('chair', box(65, 81, 79, 95), 6)
    const deskBack = item('deskBack', box(64, 96, 96, 112), 12)
    const desk = item('desk', box(64, 64, 96, 80), 12)
    expect(topoSort([deskBack, chair, desk]).map((i) => i.name)).toEqual(['desk', 'chair', 'deskBack'])
  })

  it('topological order beats the centre-sum key when they disagree', () => {
    const longWall = item('wall', box(0, 100, 400, 102), 48)
    const plant = item('plant', box(380, 80, 396, 96), 26)
    expect(topoSort([longWall, plant]).map((i) => i.name)).toEqual(['plant', 'wall'])
  })

  it('a cycle still yields every item once', () => {
    const a = item('a', box(0, 0, 10, 100))
    const b = item('b', box(20, -50, 30, 60))
    const c = item('c', box(-30, 30, 25, 40))
    const out = topoSort([a, b, c])
    expect(out).toHaveLength(3)
    expect(new Set(out.map((i) => i.name)).size).toBe(3)
  })

  it('a character goes after statics behind it and before statics in front', () => {
    const statics: Placed[] = [item('wall', box(0, 30, 256, 32), 48), item('desk', box(64, 64, 96, 80), 12), item('mureta', box(0, 180, 256, 188), 7)].map((s, rank) => ({ ...s, rank }))
    const at = (x: number, y: number) => {
      const c = item('ch', box(x - 3, y - 3, x + 3, y + 3), 30)
      return insertRank(statics, c.box, c.screen)
    }
    expect(at(80, 90)).toBe(1.5)
    expect(at(80, 50)).toBe(0.5)
    expect(at(80, 200)).toBe(2.5)
  })

  it.each([
    { yaw: 20, k: 0.55, min: 50 },
    { yaw: 0, k: 0.7, min: 50 },
  ])('at yaw $yaw a box ending before another on x or y is never in front of it along the view ray', ({ yaw, k, min }) => {
    const view = makeIsoView({ yaw, k })
    const [dx, dy, dh] = view.viewDir
    let seed = 7
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let checked = 0
    for (let n = 0; n < 4000; n++) {
      const a = box(rnd() * 200, rnd() * 200, 0, 0)
      a.maxX = a.minX + 4 + rnd() * 60
      a.maxY = a.minY + 4 + rnd() * 60
      const b = box(rnd() * 200, rnd() * 200, 0, 0)
      b.maxX = b.minX + 4 + rnd() * 60
      b.maxY = b.minY + 4 + rnd() * 60
      if (!behind(a, b) || behind(b, a)) continue
      for (let m = 0; m < 20; m++) {
        const px = a.minX + rnd() * (a.maxX - a.minX)
        const py = a.minY + rnd() * (a.maxY - a.minY)
        const ph = rnd() * 40
        for (const lam of LAMBDAS) {
          const qx = px + lam * dx
          const qy = py + lam * dy
          const qh = ph + lam * dh
          if (qh < 0 || qh > 40 || qx < b.minX || qx > b.maxX || qy < b.minY || qy > b.maxY) continue
          const pv = view.toView(px, py, ph)
          const qv = view.toView(qx, qy, qh)
          expect(qv.x).toBeCloseTo(pv.x, 6)
          expect(qv.y).toBeCloseTo(pv.y, 6)
          expect(lam).toBeGreaterThan(0)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(min)
  })

  it('at yaw 0 boxes apart on x never overlap on screen, and y alone decides', () => {
    const view = makeIsoView({ yaw: 0, k: 0.7 })
    const left = item('left', box(0, 40, 32, 72), 30, view)
    const right = item('right', box(32, 0, 64, 100), 30, view)
    expect(left.screen.x1).toBeLessThanOrEqual(right.screen.x0)
    const wall = item('wall', box(8, 30, 248, 32), 48, view)
    const desk = item('desk', box(64, 64, 96, 80), 12, view)
    const mureta = item('mureta', box(8, 180, 248, 188), 7, view)
    expect(topoSort([mureta, desk, wall], view.depthW).map((i) => i.name)).toEqual(['wall', 'desk', 'mureta'])
    expect(compareDepth(box(0, 0, 400, 10), box(390, 2, 420, 30), view.depthW)).toBeLessThan(0)
  })

  it('at yaw 20 the wall / desk / mureta order and the cutaway tie-break still hold', () => {
    const view = makeIsoView({ yaw: 20, k: 0.55 })
    const wall = item('wall', box(8, 30, 248, 32), 48, view)
    const desk = item('desk', box(64, 64, 96, 80), 12, view)
    const mureta = item('mureta', box(8, 180, 248, 188), 7, view)
    expect(topoSort([mureta, desk, wall], view.depthW).map((i) => i.name)).toEqual(['wall', 'desk', 'mureta'])
    const chair = item('chair', box(65, 81, 79, 95), 6, view)
    const deskBack = item('deskBack', box(64, 96, 96, 112), 12, view)
    expect(topoSort([deskBack, chair, desk], view.depthW).map((i) => i.name)).toEqual(['desk', 'chair', 'deskBack'])
    expect(compareDepth(box(0, 0, 40, 10), box(5, 2, 12, 30), view.depthW)).toBeLessThan(0)
    expect(compareDepth(box(0, 0, 40, 10), box(5, 2, 12, 30))).toBeGreaterThan(0)
  })

  it('a seated character stays after its chair', () => {
    const chair = { ...item('chair', box(65, 81, 79, 95), 6), rank: 3 }
    const c = item('ch', box(69, 85, 75, 91), 30)
    expect(insertRank([chair], c.box, c.screen, chair.rank)).toBe(3.5)
  })
})
