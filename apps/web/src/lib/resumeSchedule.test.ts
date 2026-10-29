import { describe, expect, it } from 'vitest'
import { cleanText, delayTo, fillOrder, MAX_DELAY_MS, nextFire, parseEntries, RESET_GRACE_MS, resetAtOf, resetLabel, splitDue, STALE_MS, upsert, without, type ResumeEntry } from './resumeSchedule'

const NOW = Date.parse('2026-10-29T10:00:00Z')
const e = (paneKey: string, at: number, createdAt = at): ResumeEntry => ({ paneKey, text: 'tiếp tục', at, createdAt })

describe('resumeSchedule', () => {
  it('only keeps a reset still ahead (with grace)', () => {
    const at = NOW + 3_600_000
    expect(resetAtOf({ at: 'x', resetsAt: new Date(at).toISOString() }, NOW)).toBe(at)
    expect(resetAtOf({ at: 'x', resetsAt: new Date(NOW - RESET_GRACE_MS - 1).toISOString() }, NOW)).toBeNull()
    expect(resetAtOf({ at: 'x' }, NOW)).toBeNull()
    expect(resetAtOf(undefined, NOW)).toBeNull()
  })

  it('upserts per pane, finds the next fire and splits due entries', () => {
    let list = upsert([], e('a', NOW + 10, 1))
    list = upsert(list, e('b', NOW + 5, 2))
    list = upsert(list, e('a', NOW + 20, 3))
    expect(list.map((x) => x.paneKey)).toEqual(['b', 'a'])
    expect(nextFire(list)).toBe(NOW + 5)
    expect(nextFire([])).toBeNull()
    const { due, rest } = splitDue(list, NOW + 5)
    expect(due.map((x) => x.paneKey)).toEqual(['b'])
    expect(rest.map((x) => x.paneKey)).toEqual(['a'])
    expect(without(list, 'a').map((x) => x.paneKey)).toEqual(['b'])
  })

  it('fills the first scheduled pane last so it keeps focus', () => {
    expect(fillOrder([e('first', 0, 1), e('third', 0, 3), e('second', 0, 2)]).map((x) => x.paneKey)).toEqual(['third', 'second', 'first'])
  })

  it('clamps the timer delay', () => {
    expect(delayTo(NOW - 5, NOW)).toBe(0)
    expect(delayTo(NOW + 99 * 86_400_000, NOW)).toBe(MAX_DELAY_MS)
  })

  it('parses stored entries defensively and drops stale ones', () => {
    const raw = JSON.stringify([e('a', NOW + 1), e('old', NOW - STALE_MS - 1), { paneKey: 5 }, { ...e('b', NOW), text: 'go\non' }])
    expect(parseEntries(raw, NOW).map((x) => [x.paneKey, x.text])).toEqual([
      ['a', 'tiếp tục'],
      ['b', 'go on'],
    ])
    expect(parseEntries('{', NOW)).toEqual([])
    expect(parseEntries(null, NOW)).toEqual([])
    expect(cleanText('  x\r\ny ')).toBe('x y')
  })

  it('labels the reset with a weekday when it is not today', () => {
    const local = new Date(2026, 9, 29, 14, 30).getTime()
    expect(resetLabel(local, new Date(2026, 9, 29, 9).getTime(), 'en-GB')).toBe('14:30')
    expect(resetLabel(local, new Date(2026, 9, 28, 9).getTime(), 'en-GB')).toMatch(/^Thu 14:30$/)
  })
})
