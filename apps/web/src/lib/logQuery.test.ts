import { describe, expect, it } from 'vitest'
import { emptyFilters, graphMode, hasFilters, toQuery } from './logQuery'

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)

describe('logQuery', () => {
  it('maps empty filters to the full history', () => {
    expect(toQuery(emptyFilters(), NOW)).toEqual({ branch: null, notRef: null, author: null, since: null, until: null, text: null, regex: false, matchCase: false, paths: [], skip: 0 })
    expect(graphMode(emptyFilters())).toBe('graph')
    expect(hasFilters(emptyFilters())).toBe(false)
  })

  it('keeps the graph for a branch filter only', () => {
    const f = { ...emptyFilters(), branch: 'refs/heads/main' }
    expect(graphMode(f)).toBe('graph')
    expect(hasFilters(f)).toBe(true)
    for (const patch of [{ author: 'Ann' }, { text: 'fix' }, { paths: ['src'] }, { date: '7d' as const }]) expect(graphMode({ ...emptyFilters(), ...patch })).toBe('flat')
  })

  it('turns date presets and ranges into epoch seconds', () => {
    expect(toQuery({ ...emptyFilters(), date: '24h' }, NOW).since).toBe(NOW / 1000 - 86400)
    expect(toQuery({ ...emptyFilters(), date: '7d' }, NOW).since).toBe(NOW / 1000 - 7 * 86400)
    const r = toQuery({ ...emptyFilters(), date: 'custom', from: '2026-10-01', to: '2026-10-02' }, NOW)
    expect(r.since).toBe(new Date(2026, 9, 1).getTime() / 1000)
    expect(r.until).toBe(new Date(2026, 9, 3).getTime() / 1000 - 1)
    expect(toQuery({ ...emptyFilters(), date: 'custom', from: 'bad' }, NOW).since).toBeNull()
  })

  it('trims text and passes skip', () => {
    expect(toQuery({ ...emptyFilters(), text: '  fix  ', regex: true }, NOW, 500)).toMatchObject({ text: 'fix', regex: true, skip: 500 })
    expect(toQuery({ ...emptyFilters(), text: '   ' }, NOW).text).toBeNull()
  })
})

describe('custom date range across DST changes', () => {
  // Each case pins the zone where that date is a 23h or 25h day, so the check does not depend on the machine.
  // The expected values come from calendar arithmetic, not +86400.
  const withTZ = (tz: string, fn: () => void): void => {
    const prev = process.env.TZ
    process.env.TZ = tz
    try {
      fn()
    } finally {
      if (prev === undefined) delete process.env.TZ
      else process.env.TZ = prev
    }
  }
  const endOf = (y: number, m: number, d: number) => new Date(y, m - 1, d + 1).getTime() / 1000 - 1
  const startOf = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime() / 1000

  it.each([
    ['America/New_York', '2026-03-08', 2026, 3, 8],
    ['Europe/Paris', '2026-03-29', 2026, 3, 29],
    ['Europe/Paris', '2026-10-25', 2026, 10, 25],
    ['Asia/Saigon', '2026-10-02', 2026, 10, 2],
  ])('ends and starts the range on local midnight in %s (%s)', (tz, date, y, m, d) => {
    withTZ(tz, () => {
      const q = toQuery({ ...emptyFilters(), date: 'custom', from: date, to: date }, NOW)
      expect(q.until).toBe(endOf(y, m, d))
      expect(q.since).toBe(startOf(y, m, d))
    })
  })
})

describe('notRef', () => {
  it('passes through and forces the flat list', () => {
    const f = { ...emptyFilters(), branch: 'refs/heads/feature', notRef: 'HEAD' }
    expect(toQuery(f, NOW).notRef).toBe('HEAD')
    expect(toQuery({ ...f, branch: null }, NOW).notRef).toBeNull()
    expect(graphMode(f)).toBe('flat')
    expect(hasFilters({ ...emptyFilters(), notRef: 'HEAD' })).toBe(true)
  })
})
