import { describe, expect, it } from 'vitest'
import type { TerminalStatus } from '@ccm/shared'
import { sortSessions } from './sessionSort'
import { groupSessions, sameSessionGroups } from './sessionGroups'

const s = (id: string, status: TerminalStatus, at = '2026-11-03T10:00:00Z') =>
  ({ id, title: id, status, startedAt: at, lastActivityAt: at }) as Parameters<typeof sortSessions>[0][number]

describe('groupSessions', () => {
  it('returns nothing for no sessions', () => {
    expect(groupSessions([])).toEqual([])
  })

  it('splits by what the session needs, in a fixed group order', () => {
    const groups = groupSessions([s('a', 'idle'), s('b', 'working'), s('c', 'waiting'), s('d', 'stale'), s('e', 'waiting')])
    expect(groups).toEqual([
      { key: 'needs', ids: ['c', 'e'] },
      { key: 'running', ids: ['b'] },
      { key: 'idle', ids: ['a'] },
      { key: 'ended', ids: ['d'] },
    ])
  })

  it('drops empty groups (all idle, one group)', () => {
    expect(groupSessions([s('a', 'idle'), s('b', 'unknown'), s('c', 'error')])).toEqual([{ key: 'idle', ids: ['a', 'b', 'c'] }])
  })

  it('keeps the given sort inside each group', () => {
    const list = [s('old', 'working', '2026-11-03T09:00:00Z'), s('new', 'working', '2026-11-03T11:00:00Z'), s('w', 'waiting')]
    const groups = groupSessions(sortSessions(list, 'activity'))
    expect(groups.map((g) => g.ids)).toEqual([['w'], ['new', 'old']])
    const byName = groupSessions(sortSessions(list, 'name'))
    expect(byName[1]!.ids).toEqual(['new', 'old'].sort())
  })

  it('compares groups for the stable-reference check', () => {
    const a = groupSessions([s('a', 'idle')])
    expect(sameSessionGroups(a, groupSessions([s('a', 'idle')]))).toBe(true)
    expect(sameSessionGroups(a, groupSessions([s('a', 'working')]))).toBe(false)
    expect(sameSessionGroups(undefined, a)).toBe(false)
  })
})
