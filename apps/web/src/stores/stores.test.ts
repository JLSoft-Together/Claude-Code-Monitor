import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Agent, MonitorSnapshot, ServerMessage, TerminalSession } from '@ccm/shared'
import { CHILD_INDENT, columnsFor, computeLayout, COLUMN_WIDTH, treeOrder, visibleAgents } from '../lib/layout'
import { useActivityStore, ACTIVITY_LIMIT } from './activity'
import { useAgentsStore } from './agents'
import { useConnectionStore } from './connection'
import { useTerminalsStore } from './terminals'

const terminal = (id: string, over: Partial<TerminalSession> = {}): TerminalSession => ({
  id,
  title: id,
  status: 'working',
  startedAt: '2026-10-07T10:00:00.000Z',
  ...over,
})

const agent = (id: string, terminalId: string, over: Partial<Agent> = {}): Agent => ({
  id,
  terminalId,
  role: 'subagent',
  status: 'working',
  parentId: `${terminalId}:main`,
  ...over,
})

const snapshot = (over: Partial<MonitorSnapshot> = {}): MonitorSnapshot => ({
  protocolVersion: 1,
  collectorStartedAt: '2026-10-07T10:00:00.000Z',
  supportedClaudeVersion: '2.1.289',
  terminals: [terminal('t1')],
  agents: [agent('t1:main', 't1', { role: 'main', parentId: undefined }), agent('a1', 't1')],
  activity: [],
  ...over,
})

const msg = (seq: number, events: ServerMessage['events']) => JSON.stringify({ seq, events })

describe('connection message handling', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('hydrates from snapshot and applies patches with null clearing fields', () => {
    const conn = useConnectionStore()
    const terminals = useTerminalsStore()
    const agents = useAgentsStore()
    conn.onMessage(msg(5, [{ type: 'snapshot', payload: snapshot() }]))
    expect(terminals.list).toHaveLength(1)
    expect(agents.byTerminal.t1?.[0]?.role).toBe('main')

    conn.onMessage(msg(6, [{ type: 'terminal.updated', payload: { id: 't1', title: 'Android Ads', status: 'waiting', waitingFor: 'permission prompt' } }]))
    expect(terminals.byId.t1).toMatchObject({ title: 'Android Ads', status: 'waiting', waitingFor: 'permission prompt' })

    conn.onMessage(msg(7, [{ type: 'terminal.updated', payload: { id: 't1', status: 'idle', waitingFor: null } }]))
    expect(terminals.byId.t1?.waitingFor).toBeUndefined()

    conn.onMessage(msg(8, [{ type: 'agent.updated', payload: { id: 'a1', status: 'teleporting' as never } }]))
    expect(agents.byId.a1?.status).toBe('unknown')
  })

  it('ignores events after a seq gap until a new snapshot arrives', () => {
    const conn = useConnectionStore()
    const terminals = useTerminalsStore()
    conn.onMessage(msg(1, [{ type: 'snapshot', payload: snapshot() }]))
    conn.onMessage(msg(3, [{ type: 'terminal.removed', payload: { id: 't1' } }]))
    expect(terminals.byId.t1).toBeDefined()
    conn.onMessage(msg(4, [{ type: 'snapshot', payload: snapshot({ terminals: [terminal('t2')] }) }]))
    expect(Object.keys(terminals.byId)).toEqual(['t2'])
    conn.onMessage(msg(5, [{ type: 'terminal.created', payload: terminal('t3') }]))
    expect(terminals.byId.t3).toBeDefined()
  })

  it('ignores malformed and unknown messages', () => {
    const conn = useConnectionStore()
    conn.onMessage('not json')
    conn.onMessage(JSON.stringify({ hello: 1 }))
    conn.onMessage(msg(1, [{ type: 'snapshot', payload: snapshot() }]))
    conn.onMessage(msg(2, [{ type: 'future.event', payload: {} } as never]))
    expect(useTerminalsStore().list).toHaveLength(1)
  })

  it('caps activity and dedupes by id', () => {
    const activity = useActivityStore()
    const many = Array.from({ length: ACTIVITY_LIMIT + 50 }, (_, i) => ({ id: `e${i}`, at: '2026-10-07T10:00:00.000Z', kind: 'tool.started' as const }))
    activity.push(many)
    activity.push([many[many.length - 1]!])
    expect(activity.items).toHaveLength(ACTIVITY_LIMIT)
    expect(activity.items[0]?.id).toBe(`e${ACTIVITY_LIMIT + 49}`)
  })
})

describe('agent map layout', () => {
  it('wraps sessions into rows without overlapping trees', () => {
    const byTerminal: Record<string, Agent[]> = {}
    for (let t = 0; t < 5; t++) {
      const id = `t${t}`
      byTerminal[id] = [agent(`${id}:main`, id, { role: 'main', parentId: undefined })]
      for (let s = 0; s < t + 1; s++) byTerminal[id]!.push(agent(`${id}-s${s}`, id))
    }
    const pos = computeLayout({ terminals: Object.keys(byTerminal), agentsByTerminal: byTerminal, perRow: 2 })
    expect(pos.size).toBe(5 + 15)
    const boxes = [...pos.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, w: 240, h: 60 }))
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false)
      }
    }
    expect(pos.get('t2:main')?.y).toBeGreaterThan(pos.get('t1-s1')!.y)
    expect(columnsFor(COLUMN_WIDTH * 3 + 10)).toBe(3)
    expect(columnsFor(100)).toBe(1)
  })
})

describe('nested subagents and finished filter', () => {
  const tree = () => [
    agent('t1:main', 't1', { role: 'main', parentId: undefined }),
    agent('a1', 't1', { startedAt: '2026-10-07T10:00:01.000Z', status: 'completed' }),
    agent('a2', 't1', { startedAt: '2026-10-07T10:00:02.000Z' }),
    agent('n1', 't1', { parentId: 'a1', startedAt: '2026-10-07T10:00:03.000Z' }),
    agent('n2', 't1', { parentId: 'n1', startedAt: '2026-10-07T10:00:04.000Z', status: 'completed' }),
    agent('o1', 't1', { parentId: 'missing', startedAt: '2026-10-07T10:00:05.000Z', status: 'cancelled' }),
  ]

  it('orders children depth-first under their parent', () => {
    expect(treeOrder(tree()).map((x) => `${x.agent.id}:${x.depth}`)).toEqual(['a1:1', 'n1:2', 'n2:3', 'a2:1', 'o1:1'])
    const pos = computeLayout({ terminals: ['t1'], agentsByTerminal: { t1: tree() }, perRow: 1 })
    expect(pos.get('n1')!.x).toBe(2 * CHILD_INDENT)
    expect(pos.get('n2')!.x).toBe(2 * CHILD_INDENT)
    expect(pos.get('n1')!.y).toBeLessThan(pos.get('a2')!.y)
  })

  it('hides finished subagents but keeps ancestors of live ones', () => {
    expect(visibleAgents(tree(), false).hidden).toBe(0)
    const { visible, hidden } = visibleAgents(tree(), true)
    expect([...visible].sort()).toEqual(['a1', 'a2', 'n1', 't1:main'])
    expect(hidden).toBe(2)
    const errored = visibleAgents([agent('t1:main', 't1', { role: 'main' }), agent('e1', 't1', { status: 'error' })], true)
    expect(errored.visible.has('e1')).toBe(true)
  })
})
