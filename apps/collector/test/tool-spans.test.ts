import { describe, expect, it } from 'vitest'
import type { Signal } from '../src/transcript.js'
import { ToolSpanLog, MAX_TOOL_NAME, SPAN_LIMIT, SPAN_RETENTION_MS } from '../src/tool-spans.js'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (ms: number) => new Date(T0 + ms).toISOString()
const use = (id: string, ms?: number, name = 'Bash'): Signal => ({ k: 'tool_use', id, name, at: ms === undefined ? undefined : iso(ms) })
const result = (id: string, ms: number, isError = false): Signal => ({ k: 'tool_result', toolUseId: id, isError, asyncLaunched: false, at: iso(ms) })
const turnEnd = (ms: number): Signal => ({ k: 'turn_end', at: iso(ms) })

describe('ToolSpanLog', () => {
  it('opens on tool_use and closes ok/error on tool_result', () => {
    const log = new ToolSpanLog('t1', () => T0)
    expect(log.apply([use('a', 0, 'Read')], 'main')).toEqual([{ id: 'a', terminalId: 't1', agentId: 'main', tool: 'Read', start: iso(0) }])
    expect(log.apply([result('a', 500)], 'main')).toEqual([
      { id: 'a', terminalId: 't1', agentId: 'main', tool: 'Read', start: iso(0), end: iso(500), outcome: 'ok' },
    ])
    log.apply([use('b', 600), result('b', 700, true)], 'main')
    expect(log.list().find((s) => s.id === 'b')).toMatchObject({ end: iso(700), outcome: 'error' })
  })

  it('skips tool_use without a timestamp and unmatched results', () => {
    const log = new ToolSpanLog('t1', () => T0)
    expect(log.apply([use('a'), result('zzz', 10)], 'main')).toEqual([])
    expect(log.list()).toEqual([])
  })

  it('ignores a repeated tool_use id', () => {
    const log = new ToolSpanLog('t1', () => T0)
    log.apply([use('a', 0)], 'main')
    expect(log.apply([use('a', 900)], 'main')).toEqual([])
    expect(log.list()).toHaveLength(1)
    expect(log.list()[0]?.start).toBe(iso(0))
  })

  it('clamps end before start to start', () => {
    const log = new ToolSpanLog('t1', () => T0)
    log.apply([use('a', 1000), result('a', 500)], 'main')
    expect(log.list()[0]?.end).toBe(iso(1000))
  })

  it("turn_end interrupts only that agent's open spans", () => {
    const log = new ToolSpanLog('t1', () => T0)
    log.apply([use('m', 0)], 'main')
    log.apply([use('s', 10)], 'a1')
    const changed = log.apply([turnEnd(100)], 'main')
    expect(changed.map((s) => s.id)).toEqual(['m'])
    const byId = Object.fromEntries(log.list().map((s) => [s.id, s]))
    expect(byId.m).toMatchObject({ end: iso(100), outcome: 'interrupted' })
    expect(byId.s?.end).toBeUndefined()
  })

  it("closeOpen interrupts all open spans (or one agent's)", () => {
    const log = new ToolSpanLog('t1', () => T0)
    log.apply([use('m', 0), use('done', 5), result('done', 6)], 'main')
    log.apply([use('s', 10)], 'a1')
    log.apply([use('s2', 20)], 'a2')
    expect(log.closeOpen(iso(15), 'a1')).toEqual([
      { id: 's', terminalId: 't1', agentId: 'a1', tool: 'Bash', start: iso(10), end: iso(15), outcome: 'interrupted' },
    ])
    const changed = log.closeOpen(iso(100))
    expect(changed.map((s) => s.id)).toEqual(['m', 's2'])
    const byId = Object.fromEntries(log.list().map((s) => [s.id, s]))
    expect(byId.m).toMatchObject({ end: iso(100), outcome: 'interrupted' })
    expect(byId.done).toMatchObject({ end: iso(6), outcome: 'ok' })
    expect(byId.s2).toMatchObject({ end: iso(100), outcome: 'interrupted' })
    expect(log.closeOpen(iso(200))).toEqual([])
    log.apply([use('late', 500)], 'main')
    expect(log.closeOpen(iso(300))[0]?.end).toBe(iso(500))
  })

  it('caps tool names at 80 chars', () => {
    const log = new ToolSpanLog('t1', () => T0)
    log.apply([use('a', 0, 'x'.repeat(200))], 'main')
    expect(log.list()[0]?.tool.length).toBe(MAX_TOOL_NAME)
  })

  it('drops closed spans older than 2h but never open ones', () => {
    let now = T0
    const log = new ToolSpanLog('t1', () => now)
    log.apply([use('closed', 0), result('closed', 10), use('open', 5)], 'main')
    now = T0 + 10 + SPAN_RETENTION_MS
    expect(log.list().map((s) => s.id)).toEqual(['closed', 'open'])
    now += 1
    expect(log.list().map((s) => s.id)).toEqual(['open'])
  })

  it('keeps at most 2000 spans, dropping the oldest closed first', () => {
    const log = new ToolSpanLog('t1', () => T0)
    log.apply([use('open', 0)], 'main')
    const sigs: Signal[] = []
    for (let i = 1; i <= SPAN_LIMIT; i++) sigs.push(use(`c${i}`, i), result(`c${i}`, i))
    log.apply(sigs, 'main')
    const ids = log.list().map((s) => s.id)
    expect(ids).toHaveLength(SPAN_LIMIT)
    expect(ids).toContain('open')
    expect(ids).not.toContain('c1')
    expect(ids).toContain(`c${SPAN_LIMIT}`)
  })

  it('list(since) keeps spans ending at or after since and open ones', () => {
    const log = new ToolSpanLog('t1', () => T0)
    log.apply([use('old', 0), result('old', 100), use('edge', 0), result('edge', 200), use('open', 50)], 'main')
    expect(log.list(T0 + 200).map((s) => s.id)).toEqual(['edge', 'open'])
  })

  it('never carries tool input or output', () => {
    const log = new ToolSpanLog('t1', () => T0)
    const u = { k: 'tool_use', id: 'a', name: 'Bash', at: iso(0), input: { command: 'secret' } } as Signal
    const r = { k: 'tool_result', toolUseId: 'a', isError: false, asyncLaunched: false, at: iso(5), content: 'secret' } as Signal
    log.apply([u, r], 'main')
    expect(JSON.stringify(log.list())).not.toContain('secret')
  })
})
