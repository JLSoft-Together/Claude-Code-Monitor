import { describe, expect, it } from 'vitest'
import { AlphaContext, BuildBudget, CHAR_LAG_MS, CHAR_STAGGER_MS, easeOutCubic, IsoReveal, REVEAL_DROP, REVEAL_MS, REVEAL_STAGGER_MAX, REVEAL_STAGGER_MIN, revealOrder } from './reveal'

function clock(start = 1000) {
  const c = { t: start, now: () => c.t }
  return c
}

describe('BuildBudget', () => {
  it('always allows the first build of a step, then stops once the budget is spent', () => {
    const c = clock()
    const b = new BuildBudget(8, c.now)
    b.begin()
    c.t += 50
    expect(b.exhausted()).toBe(false)
    b.spend()
    expect(b.exhausted()).toBe(true)
    b.begin()
    b.spend()
    c.t += 7
    expect(b.exhausted()).toBe(false)
    c.t += 1
    expect(b.exhausted()).toBe(true)
    expect(b.built).toBe(1)
  })
})

describe('revealOrder', () => {
  const view = { x0: 0, y0: 0, x1: 100, y1: 100 }
  const at = (id: string, x: number, y: number) => ({ id, box: { x0: x - 5, y0: y - 5, x1: x + 5, y1: y + 5 } })

  it('puts rooms on screen first, nearest to the view centre first', () => {
    const order = revealOrder([at('far-off', 400, 50), at('edge', 95, 50), at('centre', 50, 52), at('near-off', 120, 50), at('mid', 70, 50)], view)
    expect(order.map((o) => o.id)).toEqual(['centre', 'mid', 'edge', 'near-off', 'far-off'])
  })

  it('is stable for equal distances', () => {
    expect(revealOrder([at('b', 40, 50), at('a', 60, 50)], view).map((o) => o.id)).toEqual(['a', 'b'])
  })
})

describe('IsoReveal', () => {
  it('staggers area starts and eases each one in with a small drop', () => {
    const c = clock()
    const r = new IsoReveal(false, c.now)
    r.setExpected(10)
    const s = r.stagger()
    expect(s).toBeGreaterThanOrEqual(REVEAL_STAGGER_MIN)
    expect(s).toBeLessThanOrEqual(REVEAL_STAGGER_MAX)
    const a = r.schedule('a')
    const b = r.schedule('b')
    const d = r.schedule('d')
    expect(b - a).toBe(s)
    expect(d - b).toBe(s)
    expect(r.schedule('a')).toBe(a)
    expect(r.alpha('a')).toBe(0)
    expect(r.drop('a')).toBe(REVEAL_DROP)
    expect(r.started('b')).toBe(false)
    expect(r.alpha('b')).toBe(0)
    c.t = a + REVEAL_MS / 2
    expect(r.alpha('a')).toBeCloseTo(easeOutCubic(0.5))
    expect(r.drop('a')).toBeCloseTo((1 - easeOutCubic(0.5)) * REVEAL_DROP)
    c.t = a + REVEAL_MS
    expect(r.alpha('a')).toBe(1)
    expect(r.drop('a')).toBe(0)
    expect(r.alpha('unknown')).toBe(1)
  })

  it('keeps the whole reveal around 600–900 ms for a typical office', () => {
    const c = clock()
    for (const n of [6, 8, 10, 12]) {
      const r = new IsoReveal(false, c.now)
      r.setExpected(n)
      let last = 0
      for (let i = 0; i < n; i++) last = r.schedule(`a${i}`)
      r.finishAreas(6)
      const end = last - c.t + CHAR_LAG_MS + 5 * CHAR_STAGGER_MS + REVEAL_MS
      expect(end).toBeGreaterThanOrEqual(600)
      expect(end).toBeLessThanOrEqual(920)
      c.t = c.t + end - 1
      expect(r.done()).toBe(false)
      c.t += 1
      expect(r.done()).toBe(true)
    }
  })

  it('fades characters in after the last area, one archetype group after another', () => {
    const c = clock()
    const r = new IsoReveal(false, c.now)
    const last = r.schedule('a')
    expect(r.charAlpha(0)).toBe(0)
    r.finishAreas(3)
    expect(r.areasDone).toBe(true)
    c.t = last + CHAR_LAG_MS
    expect(r.charAlpha(0)).toBe(0)
    c.t = last + CHAR_LAG_MS + REVEAL_MS / 2
    expect(r.charAlpha(0)).toBeGreaterThan(r.charAlpha(1))
    expect(r.charAlpha(1)).toBeGreaterThan(r.charAlpha(2))
    expect(r.done()).toBe(false)
    c.t = last + CHAR_LAG_MS + 2 * CHAR_STAGGER_MS + REVEAL_MS
    expect(r.charAlpha(2)).toBe(1)
    expect(r.done()).toBe(true)
  })

  it('reduced motion: no stagger, no drop, everything at once', () => {
    const c = clock()
    const r = new IsoReveal(true, c.now)
    r.setExpected(10)
    expect(r.stagger()).toBe(0)
    expect(r.schedule('a')).toBe(r.schedule('b'))
    expect(r.alpha('a')).toBe(1)
    expect(r.drop('a')).toBe(0)
    r.finishAreas(6)
    expect(r.charAlpha(5)).toBe(1)
    expect(r.done()).toBe(true)
  })
})

describe('AlphaContext', () => {
  function fakeCtx() {
    const log: string[] = []
    const ctx = {
      globalAlpha: 1,
      save() {
        log.push(`save@${this.globalAlpha}`)
      },
      restore() {
        log.push('restore')
        this.globalAlpha = 1
      },
      translate(x: number, y: number) {
        log.push(`translate(${x},${y})`)
      },
      fillRect() {
        log.push(`fill@${this.globalAlpha}`)
      },
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, log }
  }

  it('scales every alpha the draw code sets, reads back its own value, and restores', () => {
    const { ctx, log } = fakeCtx()
    const a = new AlphaContext(ctx)
    a.begin(0.5, -4)
    const p = a.proxy
    p.fillRect(0, 0, 1, 1)
    p.globalAlpha = 0.4
    expect(p.globalAlpha).toBeCloseTo(0.4)
    expect(ctx.globalAlpha).toBeCloseTo(0.2)
    p.globalAlpha *= 0.5
    expect(ctx.globalAlpha).toBeCloseTo(0.1)
    p.fillRect(0, 0, 1, 1)
    a.end()
    expect(ctx.globalAlpha).toBe(1)
    expect(log).toEqual(['save@1', 'translate(0,-4)', 'fill@0.5', 'fill@0.1', 'restore'])
    expect(a.factor).toBe(1)
  })
})
