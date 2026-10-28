import { describe, expect, it } from 'vitest'
import type { TerminalSession } from '@ccm/shared'
import { NO_PROJECT, projectGroups, sameGroups } from './projectGroups'

const s = (id: string, cwd: string | undefined, status: TerminalSession['status'], extra: Partial<TerminalSession> = {}): TerminalSession => ({
  id,
  title: id,
  cwd,
  status,
  ...extra,
})

describe('projectGroups', () => {
  it('folds worktrees into their repo and counts statuses', () => {
    const gs = projectGroups([
      s('a', 'D:\\work\\app', 'working'),
      s('b', 'D:\\work\\app-wt\\feat-x', 'waiting'),
      s('c', 'D:\\work\\web', 'idle'),
    ])
    expect(gs.map((g) => [g.name, g.sessions, g.waiting, g.working])).toEqual([
      ['app', 2, 1, 1],
      ['web', 1, 0, 0],
    ])
  })

  it('skips stale and ended sessions, groups missing cwd apart', () => {
    const gs = projectGroups([s('a', 'C:\\x', 'stale'), s('b', 'C:\\x', 'idle', { endedAt: '2026-10-28T00:00:00Z' }), s('c', undefined, 'idle')])
    expect(gs).toHaveLength(1)
    expect(gs[0]!.key).toBe(NO_PROJECT)
  })

  it('sums reported cost only', () => {
    const gs = projectGroups([s('a', '/r', 'idle', { costUsd: 1.5 }), s('b', '/r', 'idle'), s('c', '/q', 'idle')])
    expect(gs.find((g) => g.name === 'r')!.costUsd).toBe(1.5)
    expect(gs.find((g) => g.name === 'q')!.costUsd).toBeUndefined()
  })

  it('sameGroups detects changes', () => {
    const a = projectGroups([s('a', '/r', 'idle')])
    expect(sameGroups(a, projectGroups([s('a', '/r', 'idle')]))).toBe(true)
    expect(sameGroups(a, projectGroups([s('a', '/r', 'waiting')]))).toBe(false)
  })
})
