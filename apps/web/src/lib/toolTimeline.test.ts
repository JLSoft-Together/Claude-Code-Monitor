import { describe, expect, it } from 'vitest'
import type { Agent, ToolSpan } from '@ccm/shared'
import { type Bar, formatMs, laneLayout, lanesFor, percentile, spansInWindow, ticks, toolStats } from './toolTimeline'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)
const iso = (ms: number) => new Date(ms).toISOString()

let seq = 0
const span = (over: Partial<ToolSpan> & { startMs: number; durMs?: number }): ToolSpan => {
  const { startMs, durMs, ...rest } = over
  return {
    id: `s${seq++}`,
    terminalId: 't1',
    agentId: 'main',
    tool: 'Bash',
    start: iso(startMs),
    ...(durMs === undefined ? {} : { end: iso(startMs + durMs), outcome: 'ok' as const }),
    ...rest,
  }
}

const agent = (id: string, role: Agent['role'], parentId?: string): Agent =>
  ({ id, role, parentId, terminalId: 't1', status: 'running' }) as unknown as Agent

describe('toolTimeline', () => {
  it('percentile uses nearest rank', () => {
    expect(percentile([100, 200, 300, 400], 50)).toBe(200)
    expect(percentile([100, 200, 300, 400], 95)).toBe(400)
    expect(percentile([], 50)).toBeUndefined()
  })

  it('toolStats counts, excludes running and interrupted from percentiles, warns at 3 errors and 20%', () => {
    const build = (errors: number) => [
      ...Array.from({ length: errors }, (_, i) => span({ startMs: NOW - 20 * MIN + i, durMs: 1000, outcome: 'error' })),
      ...Array.from({ length: 9 - errors }, (_, i) => span({ startMs: NOW - 10 * MIN + i, durMs: 100 * (i + 1) })),
      span({ startMs: NOW - 5 * MIN, durMs: 50_000, outcome: 'interrupted' }),
      span({ startMs: NOW - 2 * MIN }),
    ]
    const stat = toolStats(build(3), NOW)[0]!
    expect(stat).toMatchObject({ tool: 'Bash', calls: 11, errors: 3, interrupted: 1, running: 1, warn: true })
    expect(stat.errorRate).toBeCloseTo(3 / 9)
    expect(stat.p95).toBe(1000)
    const fewer = toolStats(build(2), NOW)[0]!
    expect(fewer.errors).toBe(2)
    expect(fewer.warn).toBe(false)
  })

  it('toolStats sorts by total time', () => {
    const stats = toolStats(
      [
        span({ tool: 'Read', startMs: NOW - 10 * MIN, durMs: 100 }),
        span({ tool: 'Bash', startMs: NOW - 10 * MIN, durMs: 5000 }),
        span({ tool: 'Edit', startMs: NOW - 10 * MIN, durMs: 100 }),
      ],
      NOW,
    )
    expect(stats.map((s) => s.tool)).toEqual(['Bash', 'Edit', 'Read'])
    expect(stats[0]!.totalMs).toBe(5000)
  })

  it('laneLayout clamps spans that start before the window or end in the future', () => {
    const from = NOW - 15 * MIN
    const before = span({ startMs: from - 5 * MIN, durMs: 7 * MIN })
    const future = span({ startMs: NOW - MIN, durMs: 10 * MIN })
    const open = span({ startMs: NOW - 3 * MIN })
    const [b, f, o] = laneLayout([before, future, open], from, NOW) as [Bar, Bar, Bar]
    expect(b.left).toBe(0)
    expect(b.width).toBeCloseTo((2 / 15) * 100)
    expect(f.left + f.width).toBeLessThanOrEqual(100)
    expect(o.running).toBe(true)
    expect(o.left + o.width).toBeCloseTo(100)
    expect(b.running).toBe(false)
  })

  it('spansInWindow keeps open and recently ended spans', () => {
    const from = NOW - 15 * MIN
    const old = span({ startMs: from - 10 * MIN, durMs: MIN })
    const crossing = span({ startMs: from - MIN, durMs: 2 * MIN })
    const open = span({ startMs: from - 20 * MIN })
    const late = span({ startMs: NOW - MIN, durMs: 1000 })
    const kept = spansInWindow(new Set([late, old, open, crossing]), from)
    expect(kept).toEqual([open, crossing, late])
  })

  it('lanesFor follows treeOrder and appends orphan agents', () => {
    const agents = [agent('a1', 'subagent', 'main'), agent('main', 'main'), agent('idle', 'subagent', 'main')]
    const spans = [
      span({ agentId: 'old', startMs: NOW }),
      span({ agentId: 'a1', startMs: NOW }),
      span({ agentId: 'main', startMs: NOW }),
    ]
    const lanes = lanesFor(spans, agents)
    expect(lanes.map((l) => l.agentId)).toEqual(['main', 'a1', 'old'])
    expect(lanes[1]!.depth).toBe(1)
    expect(lanes[2]!.depth).toBe(1)
    expect(lanes[2]!.agent).toBeUndefined()
    expect(lanes[0]!.spans).toHaveLength(1)
  })

  it('ticks steps 5 min up to 30 and 10 min for 60', () => {
    const now = Date.UTC(2026, 9, 9, 12, 7, 0)
    expect(ticks(now - 15 * MIN, now, 15)).toEqual([
      Date.UTC(2026, 9, 9, 11, 55),
      Date.UTC(2026, 9, 9, 12, 0),
      Date.UTC(2026, 9, 9, 12, 5),
    ])
    const t60 = ticks(now - 60 * MIN, now, 60)
    expect(t60.every((t) => t % (10 * MIN) === 0)).toBe(true)
    expect(t60).toHaveLength(6)
  })

  it('formatMs', () => {
    expect(formatMs(850)).toBe('850 ms')
    expect(formatMs(1234)).toBe('1.2 s')
    expect(formatMs(190_000)).toBe('3m 10s')
  })
})
