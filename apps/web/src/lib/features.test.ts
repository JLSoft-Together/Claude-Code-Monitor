import { describe, expect, it } from 'vitest'
import type { ActivityEvent, TerminalSession, UsageBucket } from '@ccm/shared'
import { summarizeActivity } from '../stores/away'
import { errorLoops } from './attention'
import { sessionConflicts } from './conflicts'
import { buildRecap, recapCsv } from './recap'

const T0 = Date.parse('2026-10-08T10:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const term = (id: string, patch: Partial<TerminalSession> = {}): TerminalSession => ({ id, title: id, status: 'working', ...patch })
let seq = 0
const ev = (kind: ActivityEvent['kind'], at: number, patch: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: String(seq++), kind, at: iso(at), terminalId: 't1', ...patch })

describe('session conflicts', () => {
  it('groups live sessions by repo root and branch', () => {
    const roots: Record<string, string> = { 'D:\\work\\app\\src': 'D:\\work\\app', 'D:\\work\\app': 'D:\\work\\app' }
    const list = [
      term('a', { cwd: 'D:\\work\\app\\src', gitBranch: 'main' }),
      term('b', { cwd: 'd:/work/app/', gitBranch: 'main', status: 'waiting' }),
      term('c', { cwd: 'D:\\work\\app-wt', gitBranch: 'feature' }),
      term('d', { cwd: 'D:\\work\\app', gitBranch: 'main', status: 'stale' }),
    ]
    const out = sessionConflicts(list, (cwd) => roots[cwd] ?? cwd)
    expect(out.get('a')).toEqual({ others: ['b'], hot: false })
    expect(out.get('b')?.others).toEqual(['a'])
    expect(out.has('c')).toBe(false)
    expect(out.has('d')).toBe(false)
    const hot = sessionConflicts([term('a', { cwd: 'X:\\r' }), term('b', { cwd: 'X:\\r' })], (c) => c)
    expect(hot.get('a')?.hot).toBe(true)
  })
})

describe('error loops', () => {
  it('flags repeated failures that dominate recent tool calls', () => {
    const items: ActivityEvent[] = []
    for (let i = 0; i < 6; i++) {
      items.push(ev('tool.started', T0 + i * 10_000, { data: { tool: 'Bash' } }))
      items.push(ev('tool.failed', T0 + i * 10_000 + 1, { data: { tool: 'Bash' } }))
    }
    items.push(ev('tool.failed', T0 - 10 * 60_000, { data: { tool: 'Read' } }))
    const loop = errorLoops(items.reverse(), T0 + 120_000).get('t1')
    expect(loop).toMatchObject({ failures: 6, calls: 6, tool: 'Bash' })
    expect(errorLoops(items, T0 + 20 * 60_000).size).toBe(0)
  })

  it('ignores failures that are a small share of a busy session', () => {
    const items: ActivityEvent[] = []
    for (let i = 0; i < 20; i++) items.push(ev('tool.started', T0 + i))
    for (let i = 0; i < 5; i++) items.push(ev('tool.failed', T0 + 100 + i, { data: { tool: 'Edit' } }))
    expect(errorLoops(items, T0 + 60_000).size).toBe(0)
  })
})

describe('away summary', () => {
  it('counts only events after leaving', () => {
    const items = [ev('terminal.started', T0 - 1), ev('terminal.ended', T0 + 1), ev('agent.failed', T0 + 2), ev('terminal.compacted', T0 + 3)]
    expect(summarizeActivity(items, T0)).toMatchObject({ started: 0, ended: 1, failedAgents: 1, compactions: 1 })
  })
})

describe('recap', () => {
  const bucket = (day: string, model: string, project: string, input: number): UsageBucket => ({
    key: `${day}|${model}|${project}`,
    day,
    model,
    project,
    messages: 2,
    input,
    output: 100,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 50,
  })

  it('aggregates one day and exports safe CSV', () => {
    const r = buildRecap({
      day: '2026-10-08',
      buckets: [bucket('2026-10-08', 'claude-opus-5-5', 'D:\\a', 1000), bucket('2026-10-07', 'claude-opus-5-5', 'D:\\a', 9999)],
      projectOf: (d) => d,
      history: [
        { id: 'x', title: '=cmd|calc', endedAt: new Date(2026, 9, 8, 12).toISOString(), inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, subagents: 0 },
        { id: 'y', title: 'old', endedAt: new Date(2026, 9, 7, 12).toISOString(), inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, subagents: 0 },
      ],
      timeline: null,
      response: null,
      nowMs: T0,
    })
    expect(r.tokens).toMatchObject({ input: 1000, output: 100, cacheRead: 50, messages: 2 })
    expect(r.cost).toBeGreaterThan(0)
    expect(r.ended.map((s) => s.id)).toEqual(['x'])
    expect(r.time).toBeNull()
    const csv = recapCsv(r).split('\r\n')
    expect(csv).toHaveLength(2)
    expect(csv[1]?.startsWith(`"'=cmd|calc"`) || csv[1]?.startsWith(`'=cmd|calc`)).toBe(true)
  })
})
