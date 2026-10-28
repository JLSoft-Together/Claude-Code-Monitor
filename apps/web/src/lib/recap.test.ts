import { describe, expect, it } from 'vitest'
import type { UsageBucket } from '@ccm/shared'
import { buildRecap, periodDays, periodTotals } from './recap'

const bucket = (day: string, output: number): UsageBucket => ({
  key: `${day}|m`,
  day,
  model: 'claude-sonnet-4-5',
  project: '/r',
  input: 0,
  output,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  messages: 1,
})

const base = { projectOf: (d: string) => d, history: [], timeline: null, response: null, nowMs: 0 }

describe('periodDays', () => {
  it('walks back across a month edge, oldest first', () => {
    expect(periodDays('2026-11-02', 4)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(periodDays('2026-10-28', 1)).toEqual(['2026-10-28'])
  })
})

describe('buildRecap span', () => {
  const buckets = [bucket('2026-10-20', 100), bucket('2026-10-22', 50), bucket('2026-10-28', 10)]

  it('daily keeps one day', () => {
    const r = buildRecap({ ...base, day: '2026-10-28', buckets })
    expect(r.days).toEqual(['2026-10-28'])
    expect(r.tokens.output).toBe(10)
  })

  it('weekly sums 7 days and lists each day', () => {
    const r = buildRecap({ ...base, day: '2026-10-28', span: 7, buckets })
    expect(r.perDay).toHaveLength(7)
    expect(r.tokens.output).toBe(60)
    expect(r.perDay.find((d) => d.day === '2026-10-22')!.tokens).toBe(50)
    expect(r.time).toBeNull()
    expect(r.response).toBeNull()
  })

  it('periodTotals covers only the given days', () => {
    expect(periodTotals(buckets, periodDays('2026-10-21', 7)).tokens).toBe(100)
  })
})
