import { afterEach, describe, expect, it, vi } from 'vitest'
import { cobwebSide, drawBang, drawBeacon, drawCobweb, drawPopcornBucket, PING_ARC, PING_PERIOD, pingPongBall, softGlow } from './effects'
import { FX_SCALE, IsoParticles } from './particles'
import { LIVE_MAX, LIVE_PER_FRAME, liveGrid, LiveScreens } from './screens'

type Call = { op: string; args: unknown[]; state: Record<string, unknown> }

function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = []
  const state: Record<string, unknown> = { globalAlpha: 1, imageSmoothingEnabled: false }
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, p: string) {
      if (p in state) return state[p]
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: () => {} })
      return (...args: unknown[]) => calls.push({ op: p, args, state: { ...state } })
    },
    set(_t, p: string, v) {
      state[p] = v
      return true
    },
  })
  return { ctx, calls }
}

afterEach(() => vi.unstubAllGlobals())

describe('iso ping-pong ball', () => {
  it('bounces between the players above the table and back', () => {
    const a = { x: 100, y: 50 }
    const b = { x: 160, y: 54 }
    const start = pingPongBall(a, b, 0, 0)
    expect(start.x).toBe(109)
    expect(start.y).toBe(52)
    expect(start.arc).toBeCloseTo(0)
    const far = pingPongBall(b, a, 0, PING_PERIOD)
    expect(far.x).toBe(151)
    const mid = pingPongBall(a, b, 0, PING_PERIOD / 4)
    expect(mid.arc).toBeCloseTo(PING_ARC)
    const back = pingPongBall(a, b, 0, PING_PERIOD * 1.5)
    expect(back.x).toBeCloseTo(130)
    const close = pingPongBall({ x: 0, y: 0 }, { x: 4, y: 0 }, 0, 0)
    expect(close.x).toBeGreaterThanOrEqual(0)
    expect(close.x).toBeLessThanOrEqual(4)
  })
})

describe('iso cobweb', () => {
  it('goes to the free side, like the pixel office', () => {
    expect(cobwebSide(2, false, false)).toBe('left')
    expect(cobwebSide(3, false, false)).toBe('right')
    expect(cobwebSide(2, true, false)).toBe('right')
    expect(cobwebSide(3, false, true)).toBe('left')
    expect(cobwebSide(2, true, true)).toBe('left')
  })

  it('is drawn as smooth strokes (no pixel blocks), mirrored on the right', () => {
    const { ctx, calls } = recorder()
    drawCobweb(ctx, 10, 20, 15, false)
    expect(calls.some((c) => c.op === 'fillRect' || c.op === 'drawImage')).toBe(false)
    expect(calls.filter((c) => c.op === 'stroke')).toHaveLength(1)
    expect(calls.filter((c) => c.op === 'quadraticCurveTo').length).toBe(12)
    expect(calls.find((c) => c.op === 'scale')!.args).toEqual([1, 1])
    const right = recorder()
    drawCobweb(right.ctx, 10, 20, 15, true)
    expect(right.calls.find((c) => c.op === 'scale')!.args).toEqual([-1, 1])
  })
})

describe('iso alarm and popcorn shapes', () => {
  it('beacon, bang and popcorn bucket are vector shapes with balanced save/restore', () => {
    for (const draw of [(c: CanvasRenderingContext2D) => drawBeacon(c, 0, 0, 0.1, false), (c: CanvasRenderingContext2D) => drawBeacon(c, 0, 0, 0, true), (c: CanvasRenderingContext2D) => drawBang(c, 0, 0), (c: CanvasRenderingContext2D) => drawPopcornBucket(c, 0, 0, 1)]) {
      const { ctx, calls } = recorder()
      draw(ctx)
      expect(calls.filter((c) => c.op === 'save').length).toBe(calls.filter((c) => c.op === 'restore').length)
      expect(calls.some((c) => c.op === 'fill')).toBe(true)
      expect(calls.some((c) => c.op === 'drawImage')).toBe(false)
    }
  })

  it('soft glows are cached per colour and size and survive a missing canvas', () => {
    let made = 0
    vi.stubGlobal('document', {
      createElement: () => {
        made++
        return { width: 0, height: 0, getContext: () => recorder().ctx }
      },
    })
    const a = softGlow([1, 2, 3], 32)
    expect(a).not.toBeNull()
    expect(softGlow([1, 2, 3], 32)).toBe(a)
    expect(made).toBe(1)
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    expect(softGlow([9, 9, 9], 32)).toBeNull()
  })
})

describe('iso particles', () => {
  const seq = () => {
    let i = 0
    return () => ((i++ * 0.37) % 1)
  }

  it('spawn, fall and expire with the view-scale physics', () => {
    const p = new IsoParticles(50, FX_SCALE, seq())
    p.confetti(100, 100, 10)
    p.popcorn(50, 50)
    p.coins(0, 0, 40, 0, 3)
    p.sparkle(10, 10, 4)
    p.rain(0, 0, 10)
    p.confettiFall(0, 0, 60)
    expect(p.count).toBe(20)
    for (let i = 0; i < 40; i++) p.update(0.1)
    expect(p.count).toBe(0)
  })

  it('caps the pool and draws round shapes without pixel snapping', () => {
    const p = new IsoParticles(5, FX_SCALE, seq())
    p.confetti(0, 0, 20)
    expect(p.count).toBe(5)
    p.update(0.016)
    const { ctx, calls } = recorder()
    p.draw(ctx, -1000, -1000, 1000, 1000, 0)
    expect(calls.filter((c) => c.op === 'fillRect').length).toBe(5)
    expect(calls.some((c) => c.op === 'rotate')).toBe(true)
    const q = new IsoParticles(5, FX_SCALE, seq())
    q.popcorn(0.3, 0.3)
    const r = recorder()
    q.draw(r.ctx, -10, -10, 10, 10, 0)
    const arc = r.calls.find((c) => c.op === 'arc')!
    expect(arc.args[2]).toBeCloseTo(1.1 * FX_SCALE)
  })
})

describe('iso live screens', () => {
  it('render at twice the view resolution, clamped', () => {
    expect(liveGrid(30, 13)).toEqual({ w: 60, h: 26 })
    expect(liveGrid(0.2, 1000)).toEqual({ w: 1, h: LIVE_MAX })
    expect(liveGrid(Number.NaN, 4)).toEqual({ w: 1, h: 8 })
  })

  it('paint into a scratch canvas then draw it smoothed into the fractional rect', () => {
    const scratch = recorder()
    const canvas = { width: 0, height: 0, getContext: () => scratch.ctx }
    vi.stubGlobal('document', { createElement: () => canvas })
    const out = recorder()
    const live = new LiveScreens()
    const seen: unknown[] = []
    live.paint(out.ctx, { x: 10.3, y: 4.6, w: 30, h: 13 }, 30, 13, (g, r) => seen.push(g, r))
    expect(seen[0]).toBe(scratch.ctx)
    expect(seen[1]).toEqual({ x: 0, y: 0, w: 60, h: 26 })
    expect(canvas.width).toBe(60)
    const blit = out.calls.find((c) => c.op === 'drawImage')!
    expect(blit.args).toEqual([canvas, 0, 0, 60, 26, 10.3, 4.6, 30, 13])
    expect(blit.state.imageSmoothingEnabled).toBe(true)
    expect(out.calls.filter((c) => c.op === 'fillRect')).toHaveLength(1)
    const plain = recorder()
    live.paint(plain.ctx, { x: 0, y: 0, w: 10, h: 10 }, 10, 10, () => {}, false)
    expect(plain.calls.filter((c) => c.op === 'fillRect')).toHaveLength(0)
    expect(canvas.width).toBe(60)
  })

  it('repaint at most a few cached screens per frame, taking turns', () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => recorder().ctx }) })
    const live = new LiveScreens()
    const owners = Array.from({ length: 2 * LIVE_PER_FRAME }, () => ({}))
    const frame = (now: number): number[] => {
      const drawn: number[] = []
      owners.forEach((o, i) => live.paintCached(recorder().ctx, o, now, { x: 0, y: 0, w: 4, h: 4 }, 4, 4, () => drawn.push(i)))
      return drawn
    }
    expect(frame(0)).toHaveLength(owners.length)
    expect(frame(200)).toEqual([0, 1, 2])
    expect(frame(400)).toEqual([3, 4, 5])
    expect(frame(600)).toEqual([0, 1, 2])
    expect(frame(700)).toEqual([3, 4, 5])
    expect(frame(720)).toEqual([])
  })

  it('without a scratch canvas it draws straight into the target', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    const out = recorder()
    const seen: unknown[] = []
    new LiveScreens().paint(out.ctx, { x: 1, y: 2, w: 3, h: 4 }, 3, 4, (g, r) => seen.push(g, r))
    expect(seen[0]).toBe(out.ctx)
    expect(seen[1]).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  })
})
