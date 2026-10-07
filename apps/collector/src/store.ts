import {
  PROTOCOL_VERSION,
  SUPPORTED_CLAUDE_VERSION,
  type ActivityEvent,
  type Agent,
  type MonitorEvent,
  type MonitorSnapshot,
  type ServerMessage,
  type TerminalSession,
} from '@ccm/shared'

type Listener = (message: ServerMessage) => void

function diff<T extends { id: string }>(prev: T, next: T): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  let changed = false
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of keys) {
    if (key === 'id') continue
    const a = (prev as Record<string, unknown>)[key]
    const b = (next as Record<string, unknown>)[key]
    if (a === b) continue
    patch[key] = b === undefined ? null : b
    changed = true
  }
  return changed ? patch : null
}

function clean<T extends object>(obj: T): T {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out as T
}

export class MonitorStore {
  private readonly terminals = new Map<string, TerminalSession>()
  private readonly agents = new Map<string, Agent>()
  private readonly activity: ActivityEvent[] = []
  private pending: MonitorEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private listeners = new Set<Listener>()
  private activityCounter = 0
  private seqValue = 0
  readonly startedAt = new Date().toISOString()

  constructor(
    private readonly options: { activityLimit: number; batchMs: number },
  ) {}

  get seq(): number {
    return this.seqValue
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getTerminal(id: string): TerminalSession | undefined {
    return this.terminals.get(id)
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id)
  }

  agentsOf(terminalId: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.terminalId === terminalId)
  }

  upsertTerminal(next: TerminalSession): void {
    const value = clean(next)
    const prev = this.terminals.get(value.id)
    this.terminals.set(value.id, value)
    if (!prev) return this.emit({ type: 'terminal.created', payload: value })
    const patch = diff(prev, value)
    if (patch) this.emit({ type: 'terminal.updated', payload: { ...patch, id: value.id } })
  }

  removeTerminal(id: string): void {
    for (const agent of this.agentsOf(id)) this.removeAgent(agent.id)
    if (this.terminals.delete(id)) this.emit({ type: 'terminal.removed', payload: { id } })
  }

  upsertAgent(next: Agent): void {
    const value = clean(next)
    const prev = this.agents.get(value.id)
    this.agents.set(value.id, value)
    if (!prev) return this.emit({ type: 'agent.created', payload: value })
    const patch = diff(prev, value)
    if (patch) this.emit({ type: 'agent.updated', payload: { ...patch, id: value.id } })
  }

  removeAgent(id: string): void {
    if (this.agents.delete(id)) this.emit({ type: 'agent.removed', payload: { id } })
  }

  pushActivity(event: Omit<ActivityEvent, 'id' | 'at'> & { at?: string }): void {
    const value: ActivityEvent = clean({
      ...event,
      id: `${Date.now().toString(36)}-${(this.activityCounter++).toString(36)}`,
      at: event.at ?? new Date().toISOString(),
    })
    this.activity.push(value)
    if (this.activity.length > this.options.activityLimit) {
      this.activity.splice(0, this.activity.length - this.options.activityLimit)
    }
    this.emit({ type: 'activity', payload: value })
  }

  snapshot(): MonitorSnapshot {
    return {
      protocolVersion: PROTOCOL_VERSION,
      collectorStartedAt: this.startedAt,
      supportedClaudeVersion: SUPPORTED_CLAUDE_VERSION,
      terminals: [...this.terminals.values()],
      agents: [...this.agents.values()],
      activity: [...this.activity],
    }
  }

  snapshotMessage(): ServerMessage {
    this.flush()
    return { seq: this.seqValue, events: [{ type: 'snapshot', payload: this.snapshot() }] }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pending.length === 0) return
    const message: ServerMessage = { seq: ++this.seqValue, events: this.pending }
    this.pending = []
    for (const listener of this.listeners) listener(message)
  }

  private emit(event: MonitorEvent): void {
    this.pending.push(event)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.options.batchMs)
  }
}
