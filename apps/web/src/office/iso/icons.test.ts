import { describe, expect, it } from 'vitest'
import { ICON_NAMES } from '@ccm/habblaud/client/src/art/icons'
import { drawVectorIcon, HEAD_ICON_VIEW, iconViewRect, VECTOR_ICON_VIEW, VECTOR_ICONS } from './icons'

function recCtx() {
  const calls: string[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, p: string) => (p in state ? state[p] : (...a: unknown[]) => calls.push(`${p}(${a.length})`)),
    set: (_t, p: string, v) => ((state[p] = v), true),
  })
  return { ctx, calls }
}

describe('3D head icons', () => {
  it('scales the art so its longest side is the view size, bottom-centre anchor on the head point', () => {
    const r = iconViewRect({ img: { src: null as unknown as CanvasImageSource, w: 40, h: 36 }, size: [36, 34], anchor: [18, 34] }, 100, 50, HEAD_ICON_VIEW)
    expect(r.h).toBeCloseTo(18)
    expect(r.w).toBeCloseTo(20)
    expect(r.x + 18 * 0.5).toBeCloseTo(100)
    expect(r.y + 34 * 0.5).toBeCloseTo(50)
  })

  it('vector fallbacks cover the simple icons with smooth paths, never text or bitmaps', () => {
    expect([...VECTOR_ICONS].every((n) => ICON_NAMES.includes(n))).toBe(true)
    for (const n of VECTOR_ICONS) {
      const { ctx, calls } = recCtx()
      const box = drawVectorIcon(ctx, n, 50, 80)
      expect(box, n).toEqual({ x: 50 - VECTOR_ICON_VIEW / 2, y: 80 - VECTOR_ICON_VIEW, w: VECTOR_ICON_VIEW, h: VECTOR_ICON_VIEW })
      expect(calls.some((c) => c.startsWith('fill') || c.startsWith('stroke')), n).toBe(true)
      expect(calls.some((c) => c.startsWith('fillText') || c.startsWith('drawImage') || c.startsWith('fillRect')), n).toBe(false)
      expect(calls.filter((c) => c === 'save(0)').length).toBe(calls.filter((c) => c === 'restore(0)').length)
    }
  })

  it('complex icons have no vector version (the renderer falls back to the pixel sprite)', () => {
    const { ctx, calls } = recCtx()
    for (const n of ['storm', 'trophy', 'coffee', 'music'] as const) expect(drawVectorIcon(ctx, n, 0, 0)).toBeNull()
    expect(calls).toEqual([])
  })
})
