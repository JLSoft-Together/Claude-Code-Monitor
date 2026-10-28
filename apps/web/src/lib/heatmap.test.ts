import { describe, expect, it } from 'vitest'
import { heatGrid, heatLevel } from './heatmap'

describe('heatGrid', () => {
  it('folds days into Monday-first weekdays and finds the peak', () => {
    const hours = (h: number, n: number) => Array.from({ length: 24 }, (_, i) => (i === h ? n : 0))
    // 2026-10-26 is a Monday, 2026-11-02 the next one.
    const g = heatGrid({ days: [{ day: '2026-10-26', hours: hours(9, 2) }, { day: '2026-11-02', hours: hours(9, 3) }, { day: '2026-10-28', hours: hours(14, 1) }] })
    expect(g.rows[0]![9]).toBe(5)
    expect(g.rows[2]![14]).toBe(1)
    expect(g).toMatchObject({ max: 5, total: 6, peak: { weekday: 0, hour: 9 } })
    expect(heatGrid(null)).toMatchObject({ total: 0, peak: null })
  })

  it('levels by quartile', () => {
    expect([0, 1, 3, 6, 10].map((n) => heatLevel(n, 10))).toEqual([0, 1, 2, 3, 4])
  })
})
