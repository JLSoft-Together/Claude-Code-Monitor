import { describe, expect, it } from 'vitest'
import type { Agent, TerminalSession } from '@ccm/shared'
import { cacheState, quietFor } from './attention'
import { effortLabel, modelLabel } from './model'
import { sortSessions } from './sessionSort'

const term = (id: string, patch: Partial<TerminalSession> = {}): TerminalSession => ({ id, title: id, status: 'working', ...patch })
const T0 = Date.parse('2026-10-08T10:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('session sort', () => {
  it('puts pinned first and ended last', () => {
    const list = [term('a', { lastActivityAt: iso(T0) }), term('b', { lastActivityAt: iso(T0 - 600_000) }), term('c', { status: 'stale' })]
    expect(sortSessions(list, 'activity', new Set(['b', 'c'])).map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('does not reorder on activity inside the same minute', () => {
    const list = [term('a', { lastActivityAt: iso(T0 + 5_000) }), term('b', { lastActivityAt: iso(T0 + 50_000) })]
    expect(sortSessions(list, 'activity').map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('attention', () => {
  it('flags a quiet working session only past the threshold', () => {
    const x = term('a', { lastActivityAt: iso(T0) })
    expect(quietFor(x, T0 + 9 * 60_000, 10)).toBeNull()
    expect(quietFor(x, T0 + 11 * 60_000, 10)).toBe(11 * 60_000)
    expect(quietFor(x, T0 + 11 * 60_000, 0)).toBeNull()
    expect(quietFor({ ...x, status: 'waiting' }, T0 + 60 * 60_000, 10)).toBeNull()
  })

  it('estimates the cost of a cold cache', () => {
    const agent: Agent = {
      id: 'm',
      terminalId: 'a',
      role: 'main',
      status: 'waiting',
      model: 'claude-opus-5-5',
      contextTokens: 100_000,
      cacheTtl: '5m',
      cacheAt: iso(T0),
    }
    const waiting = term('a', { status: 'waiting' })
    expect(cacheState(agent, waiting, T0 + 60_000)?.expired).toBe(false)
    const cold = cacheState(agent, waiting, T0 + 6 * 60_000)
    expect(cold?.expired).toBe(true)
    expect(cold?.extraCost).toBeCloseTo((100_000 * (4 * 1.25 - 0.2)) / 1_000_000)
    expect(cacheState(agent, term('a'), T0 + 6 * 60_000)).toBeNull()
  })
})

describe('model labels', () => {
  it('prefers catalog names and localizes effort', () => {
    expect(modelLabel('claude-opus-5-5[1m]', 1_000_000, { 'claude-opus-5-5': 'Opus 5.5 New' })).toBe('Opus 5.5 New · 1M')
    expect(effortLabel('high', (k) => `T:${k}`)).toBe('T:effort.high')
    expect(effortLabel('ultra', (k) => k)).toBe('ultra')
    expect(effortLabel(undefined, (k) => k)).toBeNull()
  })
})
