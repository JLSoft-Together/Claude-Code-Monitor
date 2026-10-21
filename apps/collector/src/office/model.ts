import type { Agent, TerminalSession, ToolSpan } from '@ccm/shared'
import type { AccountInfo, Activity, AgentInfo, AgentStatus, OfficeSnapshot, Provider, RoomInfo, ShellJob } from '@ccm/habblaud/shared/types'
import { describeTool } from '@ccm/habblaud/shared/activity'
import { hash32 } from '@ccm/habblaud/shared/hash'
import type { NameStore } from '@ccm/habblaud/server/model/names'
import { SlotAllocator, roomDisplayNames } from '@ccm/habblaud/server/model/rooms'
import type { PersonName } from '@ccm/habblaud/shared/names'

// Mirror upstream Habblaud server/model/office.ts.
export const OFFLINE_GRACE_MS = 20_000
export const DONE_GRACE_MS = 25_000
export const SLOT_COOLDOWN_MS = 30_000
export const SNAPSHOT_RECENT = 8

const UNKNOWN_ROOM = '(unknown)'
const SPAN_KEEP = 64

/** Room identity: cwd with `/` separators, no trailing slash, lowercased on Windows. */
export function roomKey(cwd: string | undefined, platform: NodeJS.Platform): string {
  const raw = (cwd ?? '').trim()
  if (!raw) return UNKNOWN_ROOM
  let p = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return platform === 'win32' ? p.toLowerCase() : p
}

/** Original-case room path: `/` separators, no trailing slash. */
function displayPath(cwd: string | undefined): string {
  const raw = (cwd ?? '').trim()
  if (!raw) return UNKNOWN_ROOM
  const p = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

interface Entry {
  agent: Agent
  terminal?: TerminalSession
  /** When the agent went offline / done; absent while live. */
  goneAt?: number
  /** First time the model saw the agent: stable fallback for missing timestamps. */
  seenAt: number
}

interface SpanLog {
  spans: Map<string, ToolSpan>
  count: number
}

export interface OfficeModelDeps {
  names: NameStore
  platform?: NodeJS.Platform
  now?: () => number
  version?: string
}

export class OfficeModel {
  private readonly names: NameStore
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly version: string
  private readonly startedAt: number
  private readonly slots = new SlotAllocator(SLOT_COOLDOWN_MS)
  private readonly known = new Map<string, Entry>()
  private readonly people = new Map<string, PersonName>()
  private readonly spanLogs = new Map<string, SpanLog>()
  /** Agents whose grace ended while the collector still reports them finished/stale: they must not reappear. */
  private readonly expired = new Set<string>()
  /** First-seen original-case display path per room id. */
  private readonly roomPathOf = new Map<string, string>()
  private rev = 0
  private lastKey = ''

  constructor(deps: OfficeModelDeps) {
    this.names = deps.names
    this.platform = deps.platform ?? process.platform
    this.now = deps.now ?? Date.now
    this.version = deps.version ?? ''
    this.startedAt = this.now()
  }

  setState(terminals: readonly TerminalSession[], agents: readonly Agent[]): void {
    const now = this.now()
    const terms = new Map(terminals.map((t) => [t.id, t]))
    const seen = new Set<string>()
    for (const id of [...this.expired]) if (!agents.some((a) => a.id === id)) this.expired.delete(id)
    for (const agent of agents) {
      const live = terms.get(agent.terminalId)
      if (this.expired.has(agent.id)) {
        if (this.isGone(agent, live)) continue
        this.expired.delete(agent.id)
      }
      seen.add(agent.id)
      const prev = this.known.get(agent.id)
      const entry: Entry = { agent, terminal: live ?? prev?.terminal, goneAt: prev?.goneAt, seenAt: prev?.seenAt ?? now }
      if (this.isGone(agent, live)) entry.goneAt ??= now
      else delete entry.goneAt
      this.known.set(agent.id, entry)
    }
    // Agents that vanished from the state leave after their grace period.
    for (const [id, entry] of this.known) {
      if (!seen.has(id)) entry.goneAt ??= now
    }
  }

  addSpan(span: ToolSpan): void {
    let log = this.spanLogs.get(span.agentId)
    if (!log) this.spanLogs.set(span.agentId, (log = { spans: new Map(), count: 0 }))
    if (!log.spans.has(span.id)) log.count++
    log.spans.set(span.id, span)
    while (log.spans.size > SPAN_KEEP) log.spans.delete(log.spans.keys().next().value as string)
  }

  /** Drops agents whose grace period ended. True when something changed. */
  tick(): boolean {
    const now = this.now()
    let changed = false
    for (const [id, entry] of this.known) {
      if (entry.goneAt !== undefined && now - entry.goneAt > this.graceOf(entry.agent)) {
        this.known.delete(id)
        this.expired.add(id)
        this.people.delete(id)
        this.spanLogs.delete(id)
        changed = true
      }
    }
    return changed
  }

  snapshot(): OfficeSnapshot {
    const now = this.now()
    const live = [...this.known.values()].filter((e) => e.goneAt === undefined || now - e.goneAt <= this.graceOf(e.agent))
    const children = new Map<string, number>()
    for (const e of live) if (e.agent.parentId) children.set(e.agent.parentId, (children.get(e.agent.parentId) ?? 0) + 1)

    const roomPaths = new Map<string, string>()
    const roomStart = new Map<string, number>()
    const roomOf = new Map<string, string>()
    for (const e of live) {
      const id = roomKey(e.terminal?.cwd, this.platform)
      roomOf.set(e.agent.id, id)
      if (!this.roomPathOf.has(id)) this.roomPathOf.set(id, displayPath(e.terminal?.cwd))
      roomPaths.set(id, this.roomPathOf.get(id)!)
      const started = this.ts(e.terminal?.startedAt ?? e.agent.startedAt, e.seenAt)
      roomStart.set(id, Math.min(roomStart.get(id) ?? started, started))
    }
    for (const id of [...this.roomPathOf.keys()]) if (!roomPaths.has(id)) this.roomPathOf.delete(id)
    this.slots.sync(roomPaths.keys(), now)
    const display = roomDisplayNames(roomPaths)
    const rooms: RoomInfo[] = [...roomPaths.keys()].map((id) => ({
      id,
      name: display.get(id) ?? id,
      path: roomPaths.get(id)!,
      slot: this.slots.slotOf(id) ?? 0,
      seed: hash32(id),
      createdAt: roomStart.get(id) ?? 0,
    }))

    const used = new Set([...this.people.values()].map((p) => p.name))
    const agents: AgentInfo[] = live.map((e) => this.toInfo(e, roomOf.get(e.agent.id)!, children, used))

    const accounts = new Map<Provider, AccountInfo>()
    for (const a of agents) {
      const provider = a.provider ?? 'claude'
      let acc = accounts.get(provider)
      if (!acc) {
        acc = {
          id: provider,
          provider,
          short: provider === 'codex' ? 'X' : 'C',
          name: provider === 'codex' ? 'Codex' : 'Claude',
          color: '#000000',
          configDir: '',
          sessions: 0,
          usageStatus: 'disabled',
        }
        accounts.set(provider, acc)
      }
      if (a.kind === 'main' && a.status !== 'offline') acc.sessions++
    }

    const snap: OfficeSnapshot = {
      rev: this.rev,
      serverTime: now,
      rooms,
      agents,
      accounts: [...accounts.values()],
      meta: { demo: false, sources: [], startedAt: this.startedAt, version: this.version },
    }
    const key = JSON.stringify({ ...snap, rev: 0, serverTime: 0 })
    if (key !== this.lastKey) {
      this.lastKey = key
      snap.rev = ++this.rev
    }
    return snap
  }

  private graceOf(agent: Agent): number {
    return agent.role === 'main' ? OFFLINE_GRACE_MS : DONE_GRACE_MS
  }

  private isGone(agent: Agent, terminal: TerminalSession | undefined): boolean {
    if (agent.role === 'main') return !terminal || terminal.status === 'stale'
    return agent.status === 'completed' || agent.status === 'error' || agent.status === 'cancelled'
  }

  private ts(iso: string | undefined, fallback: number): number {
    const n = iso ? Date.parse(iso) : NaN
    return Number.isFinite(n) ? n : fallback
  }

  private statusOf(e: Entry): AgentStatus {
    const { agent, terminal } = e
    if (agent.role === 'main') {
      if (e.goneAt !== undefined || !terminal) return 'offline'
      switch (terminal.status) {
        case 'working':
          return 'working'
        case 'waiting':
          return 'waiting'
        case 'idle':
          return terminal.backgroundShell ? 'shell' : 'idle'
        default:
          return 'idle'
      }
    }
    if (e.goneAt !== undefined) return 'done'
    switch (agent.status) {
      case 'working':
      case 'waiting':
      case 'idle':
        return agent.status
      default:
        return 'working'
    }
  }

  /** Tool name, kind, icon and time only: `describeTool` gets no input, and its `detail` never leaves. */
  private toActivity(agentId: string, tool: string, at: number): Activity {
    const d = describeTool(tool, undefined)
    return { id: `${agentId}:${at}`, kind: d.kind, icon: d.icon, text: d.text, tool, at }
  }

  private toInfo(e: Entry, roomId: string, children: Map<string, number>, used: Set<string>): AgentInfo {
    const { agent, terminal } = e
    const now = e.seenAt
    const main = agent.role === 'main'
    let person = this.people.get(agent.id)
    if (!person) {
      person = this.names.assign(agent.id, used)
      this.people.set(agent.id, person)
      used.add(person.name)
    }
    const status = this.statusOf(e)
    const provider = agent.provider ?? terminal?.provider ?? 'claude'
    const log = this.spanLogs.get(agent.id)
    const startedAt = this.ts(agent.startedAt ?? terminal?.startedAt, now)
    const lastEventAt = this.ts(agent.updatedAt ?? terminal?.lastActivityAt, now)
    const statusSince = e.goneAt ?? this.ts(main ? terminal?.statusSince : agent.updatedAt, now)

    const recent: Activity[] = [...(log?.spans.values() ?? [])].slice(-SNAPSHOT_RECENT).map((s) => {
      const start = this.ts(s.start, now)
      return {
        ...this.toActivity(agent.id, s.tool, start),
        id: s.id,
        ...(s.end ? { durationMs: Math.max(0, this.ts(s.end, now) - start) } : {}),
        ...(s.outcome === 'error' ? { error: true } : {}),
      }
    })
    const shells: ShellJob[] =
      main && terminal?.backgroundShell && status !== 'offline'
        ? [{ id: `${terminal.id}:bg`, label: '', startedAt: statusSince, background: true, kind: 'shell' }]
        : []

    const info: AgentInfo = {
      id: agent.id,
      kind: main ? 'main' : 'sub',
      provider,
      roomId,
      name: person.name,
      look: person.look,
      role: main ? 'main' : (agent.type ?? 'sub'),
      sessionId: agent.terminalId,
      account: provider,
      status,
      recent,
      tasks: [],
      shells,
      startedAt,
      lastEventAt,
      statusSince,
      stats: {
        toolCalls: log?.count ?? 0,
        tokensIn: (agent.inputTokens ?? 0) + (agent.cacheReadTokens ?? 0),
        tokensOut: agent.outputTokens ?? 0,
        subagents: children.get(agent.id) ?? 0,
      },
      seed: hash32(agent.id),
    }
    if (agent.parentId) info.parentId = agent.parentId
    const title = main ? (terminal?.alias ?? terminal?.title) : agent.description
    if (title) info.title = title
    if (status === 'waiting' && main && terminal?.waitingFor) info.waitingFor = terminal.waitingFor
    if (agent.currentTool) info.activity = this.toActivity(agent.id, agent.currentTool, lastEventAt)
    return info
  }
}
