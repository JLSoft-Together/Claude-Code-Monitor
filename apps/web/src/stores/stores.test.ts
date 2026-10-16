import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { Agent, MonitorSnapshot, ServerMessage, TerminalSession } from '@ccm/shared'
import { useActivityStore, ACTIVITY_LIMIT, TOOL_ACTIVITY_LIMIT } from './activity'
import { useAgentsStore } from './agents'
import { useConnectionStore } from './connection'
import { useExtrasStore } from './extras'
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

  it('keeps Codex limits apart from Claude plan limits', () => {
    const conn = useConnectionStore()
    const extras = useExtrasStore()
    const codexLimits = { fiveHour: { usedPct: 12 }, updatedAt: '2026-10-11T10:00:00.000Z', plan: 'plus' }
    conn.onMessage(msg(1, [{ type: 'snapshot', payload: snapshot({ codexLimits }) }]))
    expect(extras.codexLimits?.plan).toBe('plus')
    expect(extras.limits).toBeNull()
    conn.onMessage(msg(2, [{ type: 'codexLimits.updated', payload: { ...codexLimits, fiveHour: { usedPct: 40 } } }]))
    expect(extras.codexLimits?.fiveHour?.usedPct).toBe(40)
    expect(extras.limits).toBeNull()
  })

  it('shows sessions loading from the snapshot until the collector reports the first pass done', () => {
    const conn = useConnectionStore()
    const terminals = useTerminalsStore()
    conn.onMessage(msg(1, [{ type: 'snapshot', payload: snapshot({ terminals: [], loading: true }) }]))
    expect(conn.sessionsLoading).toBe(true)
    conn.onMessage(msg(2, [{ type: 'terminal.created', payload: terminal('t9') }]))
    expect(terminals.byId.t9).toBeDefined()
    conn.onMessage(msg(3, [{ type: 'sessions.loading', payload: { loading: false } }]))
    expect(conn.sessionsLoading).toBe(false)
    conn.onMessage(msg(4, [{ type: 'snapshot', payload: snapshot() }]))
    expect(conn.sessionsLoading).toBe(false)
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
    const many = Array.from({ length: ACTIVITY_LIMIT + 50 }, (_, i) => ({ id: `e${i}`, at: '2026-10-07T10:00:00.000Z', kind: 'agent.started' as const }))
    activity.push(many)
    activity.push([many[many.length - 1]!])
    expect(activity.items).toHaveLength(ACTIVITY_LIMIT)
    expect(activity.items[0]?.id).toBe(`e${ACTIVITY_LIMIT + 49}`)
  })

  it('keeps tool events from evicting other activity', () => {
    const activity = useActivityStore()
    activity.push([{ id: 'wait', at: '2026-10-07T10:00:00.000Z', kind: 'terminal.status' }])
    activity.push(Array.from({ length: TOOL_ACTIVITY_LIMIT + 20 }, (_, i) => ({ id: `t${i}`, at: '2026-10-07T10:00:01.000Z', kind: 'tool.started' as const })))
    expect(activity.items).toHaveLength(TOOL_ACTIVITY_LIMIT + 1)
    expect(activity.items.at(-1)?.id).toBe('wait')
  })
})

describe('launch terminal setting', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to terminal, persists and reads back', async () => {
    const { useUiStore } = await import('./ui')
    const ui = useUiStore()
    expect(ui.launchTerminal).toBe('terminal')
    ui.launchTerminal = 'iterm'
    await nextTick()
    expect(localStorage.getItem('ccm.launchTerminal')).toBe('iterm')
    setActivePinia(createPinia())
    expect(useUiStore().launchTerminal).toBe('iterm')
    localStorage.setItem('ccm.launchTerminal', 'warp')
    setActivePinia(createPinia())
    expect(useUiStore().launchTerminal).toBe('terminal')
  })
})
