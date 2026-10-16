import { describe, expect, it } from 'vitest'
import { bodyAspect, missionLayout, tailLines, tileRows, type MissionLayoutSpec } from './missionLayout'
import { parseDuration } from './missionMotion'

const spec = (over: Partial<MissionLayoutSpec> = {}): MissionLayoutSpec => ({
  width: 1888,
  height: 960,
  counts: [3],
  aspect: 1.6,
  head: 36,
  gap: 12,
  sectionHead: 34,
  sectionGap: 24,
  min: 280,
  max: 720,
  ...over,
})

function usedHeight(s: MissionLayoutSpec, cols: number[], cardW: number, bodyH: number): number {
  return s.counts.reduce((sum, n, i) => {
    const rows = Math.ceil(n / cols[i]!)
    return sum + s.sectionHead + rows * (s.head + bodyH) + (rows - 1) * s.gap + (i ? s.sectionGap : 0)
  }, 0)
}

describe('mission layout', () => {
  it('grows a few cards as far as the screen allows, capped at the max width', () => {
    const one = missionLayout(spec({ counts: [1] }))
    expect(one).toMatchObject({ cardW: 720, bodyH: 450, cols: [1], contentW: 720, fits: true })
    const row = missionLayout(spec({ counts: [3], height: 500 }))
    expect(row).toMatchObject({ cardW: 621, cols: [3], contentW: 3 * 621 + 2 * 12, fits: true })
  })

  it('wraps to a second row when that makes every card bigger', () => {
    const l = missionLayout(spec({ counts: [3] }))
    expect(l).toMatchObject({ cardW: 673, bodyH: 420, cols: [2], contentW: 2 * 673 + 12 })
    expect(usedHeight(spec({ counts: [3] }), l.cols, l.cardW, l.bodyH)).toBeLessThanOrEqual(960)
  })

  it('fills the height when there are more cards than one row holds', () => {
    const s = spec({ counts: [5, 3] })
    const l = missionLayout(s)
    expect(l.fits).toBe(true)
    expect(l.cardW).toBeGreaterThan(280)
    expect(l.cardW).toBeLessThan(720)
    expect(usedHeight(s, l.cols, l.cardW, l.bodyH)).toBeLessThanOrEqual(s.height)
    const bigger = missionLayout({ ...s, max: l.cardW + 40, min: l.cardW + 20 })
    expect(usedHeight(s, bigger.cols, bigger.cardW, bigger.bodyH)).toBeGreaterThan(s.height)
  })

  it('never puts more columns in a project than it has cards, nor wider than the screen', () => {
    const l = missionLayout(spec({ counts: [1, 6, 2], width: 1200, height: 2000 }))
    expect(l.cols[0]).toBe(1)
    expect(l.cols[2]).toBeLessThanOrEqual(2)
    for (const c of l.cols) expect(c * l.cardW + (c - 1) * 12).toBeLessThanOrEqual(1200)
  })

  it('falls back to the smallest cards that fill the width and scrolls when nothing fits', () => {
    const l = missionLayout(spec({ counts: [40], width: 1200, height: 600 }))
    expect(l.fits).toBe(false)
    expect(l.cols).toEqual([4])
    expect(l.cardW).toBe(291)
  })

  it('shrinks to a narrow overlay and survives a zero size', () => {
    expect(missionLayout(spec({ width: 200, counts: [2] }))).toMatchObject({ cardW: 200, cols: [1] })
    const zero = missionLayout(spec({ width: 0, height: 0, counts: [2] }))
    expect(zero.cardW).toBeGreaterThan(0)
    expect(missionLayout(spec({ counts: [] }))).toMatchObject({ cols: [], fits: true })
  })

  it('keeps the canvas shape for the thumbnail, within sane bounds', () => {
    expect(bodyAspect(1600, 1000)).toBe(1.6)
    expect(bodyAspect(3000, 500)).toBe(2.4)
    expect(bodyAspect(500, 1000)).toBe(1.1)
    expect(bodyAspect(0, 0)).toBe(1.6)
  })
})

describe('mission thumbnail rows', () => {
  const m = { inset: 2, gap: 2, head: 20, pad: 8, line: 15.6 }

  it('shows as many output lines as the tile is tall', () => {
    expect(tileRows(160, 1, m)).toBe(8)
    expect(tileRows(450, 1, m)).toBe(27)
    expect(tileRows(450, 0.5, m)).toBe(13)
    expect(tileRows(40, 0.25, m)).toBe(1)
    expect(tileRows(800, 1, m, 48)).toBe(48)
  })

  it('keeps the last lines', () => {
    expect(tailLines('a\nb\nc\nd', 2)).toBe('c\nd')
    expect(tailLines('a\nb', 5)).toBe('a\nb')
    expect(tailLines('', 3)).toBe('')
  })
})

describe('mission motion tokens', () => {
  it('reads CSS durations', () => {
    expect(parseDuration('220ms')).toBe(220)
    expect(parseDuration(' 0.3s ')).toBe(300)
    expect(parseDuration('fast')).toBeNull()
  })
})
