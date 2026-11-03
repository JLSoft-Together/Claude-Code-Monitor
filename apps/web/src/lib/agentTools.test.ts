import { describe, expect, it } from 'vitest'
import type { ToolSpan } from '@ccm/shared'
import { toolRows, TOOL_ROWS } from './agentTools'

const span = (id: string, agentId: string, start: string, over: Partial<ToolSpan> = {}): ToolSpan => ({ id, terminalId: 't1', agentId, tool: 'Read', start, ...over })

describe('toolRows', () => {
  it('keeps only this agent, newest first, with duration and outcome', () => {
    const { rows, older } = toolRows(
      [
        span('a', 'sub1', '2026-11-03T10:00:00Z', { end: '2026-11-03T10:00:02Z', outcome: 'ok', tool: 'Grep' }),
        span('b', 'sub2', '2026-11-03T10:00:01Z', { end: '2026-11-03T10:00:03Z' }),
        span('c', 'sub1', '2026-11-03T10:01:00Z', { end: '2026-11-03T10:01:00.500Z', outcome: 'error', tool: 'Bash' }),
      ],
      'sub1',
      true,
    )
    expect(rows.map((r) => [r.id, r.tool, r.ms, r.state])).toEqual([
      ['c', 'Bash', 500, 'error'],
      ['a', 'Grep', 2000, 'ok'],
    ])
    expect(older).toBe(0)
  })

  it('an open call is running on a live agent and interrupted once the agent is done', () => {
    const open = [span('x', 'sub1', '2026-11-03T10:00:00Z')]
    expect(toolRows(open, 'sub1', true).rows[0]).toMatchObject({ ms: null, state: 'running' })
    expect(toolRows(open, 'sub1', false).rows[0]).toMatchObject({ ms: null, state: 'interrupted' })
  })

  it('a closed span without an outcome counts as ok', () => {
    expect(toolRows([span('x', 'sub1', '2026-11-03T10:00:00Z', { end: '2026-11-03T10:00:01Z' })], 'sub1', true).rows[0]!.state).toBe('ok')
  })

  it('no spans (not loaded, or none recorded) gives an empty list, not an error', () => {
    expect(toolRows([], 'sub1', true)).toEqual({ rows: [], older: 0 })
  })

  it('shows the latest 30 and counts the older ones', () => {
    const many = Array.from({ length: 45 }, (_, i) => span(`s${i}`, 'sub1', new Date(Date.UTC(2026, 10, 3, 10, 0, i)).toISOString(), { end: new Date(Date.UTC(2026, 10, 3, 10, 0, i, 100)).toISOString() }))
    const { rows, older } = toolRows(many, 'sub1', true)
    expect(rows).toHaveLength(TOOL_ROWS)
    expect(rows[0]!.id).toBe('s44')
    expect(older).toBe(15)
  })

  it('never carries tool arguments: a row is only id, name, time, duration and state', () => {
    const row = toolRows([{ ...span('x', 'sub1', '2026-11-03T10:00:00Z', { end: '2026-11-03T10:00:01Z' }), input: { secret: 'k' } } as ToolSpan], 'sub1', true).rows[0]!
    expect(Object.keys(row).sort()).toEqual(['id', 'ms', 'start', 'state', 'tool'])
  })
})
