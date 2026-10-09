import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { MonitorEvent, ToolSpan } from '@ccm/shared'
import { useConnectionStore } from './connection'
import { useToolSpansStore } from './toolSpans'

const span = (id: string, terminalId: string, over: Partial<ToolSpan> = {}): ToolSpan => ({
  id,
  terminalId,
  agentId: `${terminalId}:main`,
  tool: 'Bash',
  start: '2026-10-09T10:00:00.000Z',
  ...over,
})

let seq = 0
const live = (event: MonitorEvent) => useConnectionStore().onMessage(JSON.stringify({ seq: seq++, events: [event] }))
const direct = (event: MonitorEvent) => useConnectionStore().onMessage(JSON.stringify({ seq: -1, direct: true, events: [event] }))

describe('toolSpans store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seq = 0
  })

  it('upserts tool.span events by id', () => {
    live({ type: 'tool.span', payload: span('a', 't1') })
    live({ type: 'tool.span', payload: span('a', 't1', { end: '2026-10-09T10:00:05.000Z', outcome: 'ok' }) })
    const spans = useToolSpansStore().spansFor('t1')
    expect(spans).toHaveLength(1)
    expect(spans[0]?.end).toBe('2026-10-09T10:00:05.000Z')
  })

  it('keeps a closed span over an older open copy', () => {
    const closed = span('a', 't1', { end: '2026-10-09T10:00:05.000Z', outcome: 'ok' })
    live({ type: 'tool.span', payload: closed })
    direct({ type: 'toolSpans.data', payload: { terminalId: 't1', spans: [span('a', 't1')] } })
    expect(useToolSpansStore().spansFor('t1')).toEqual([closed])
  })

  it('toolSpans.data replaces only its scope and since range', () => {
    const store = useToolSpansStore()
    live({ type: 'tool.span', payload: span('other', 't2') })
    live({ type: 'tool.span', payload: span('old', 't1', { end: '2026-10-09T09:00:05.000Z' }) })
    live({ type: 'tool.span', payload: span('stale', 't1', { end: '2026-10-09T10:00:05.000Z' }) })
    direct({
      type: 'toolSpans.data',
      payload: { terminalId: 't1', since: '2026-10-09T09:30:00.000Z', spans: [span('fresh', 't1')] },
    })
    expect(store.spansFor('t2').map((s) => s.id)).toEqual(['other'])
    expect(store.spansFor('t1').map((s) => s.id).sort()).toEqual(['fresh', 'old'])
    expect(store.spansFor().map((s) => s.id).sort()).toEqual(['fresh', 'old', 'other'])
  })

  it('drops spans of a removed terminal', () => {
    live({ type: 'tool.span', payload: span('a', 't1') })
    live({ type: 'terminal.removed', payload: { id: 't1' } })
    expect(useToolSpansStore().spansFor('t1')).toEqual([])
  })

  it('prunes closed spans older than 2h', () => {
    const store = useToolSpansStore()
    const now = Date.parse('2026-10-09T12:00:00.000Z')
    live({ type: 'tool.span', payload: span('gone', 't1', { end: '2026-10-09T09:59:00.000Z' }) })
    live({ type: 'tool.span', payload: span('kept', 't1', { end: '2026-10-09T10:30:00.000Z' }) })
    live({ type: 'tool.span', payload: span('open', 't1') })
    const before = store.version
    store.prune(now)
    expect(store.spansFor('t1').map((s) => s.id).sort()).toEqual(['kept', 'open'])
    expect(store.version).toBeGreaterThan(before)
  })
})
