import { describe, expect, it } from 'vitest'
import type { TerminalStatus } from '@ccm/shared'
import { waitingSummary } from './waitingStrip'

const s = (id: string, status: TerminalStatus, statusSince?: string) => ({ id, status, statusSince })

describe('waitingSummary', () => {
  it('is empty with no sessions', () => {
    expect(waitingSummary([], 0, () => false)).toEqual({ count: 0, oldest: null })
  })

  it('counts only waiting sessions and finds the one waiting longest', () => {
    const r = waitingSummary(
      [s('a', 'working'), s('b', 'waiting', '2026-11-03T10:05:00Z'), s('c', 'waiting', '2026-11-03T10:00:00Z'), s('d', 'idle')],
      0,
      () => false,
    )
    expect(r.count).toBe(2)
    expect(r.oldest?.id).toBe('c')
  })

  it('skips snoozed sessions and adds blocked jobs to the count only', () => {
    const r = waitingSummary([s('b', 'waiting', '2026-11-03T10:05:00Z'), s('c', 'waiting', '2026-11-03T10:00:00Z')], 2, (id) => id === 'c')
    expect(r.count).toBe(3)
    expect(r.oldest?.id).toBe('b')
  })

  it('keeps the count when no waiting session has a start time', () => {
    expect(waitingSummary([s('a', 'waiting')], 0, () => false)).toEqual({ count: 1, oldest: null })
  })
})
