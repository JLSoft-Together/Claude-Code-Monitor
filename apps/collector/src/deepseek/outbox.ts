import os from 'node:os'
import path from 'node:path'

// Envelope and event names from Codewhale 0.10.2 `crates/hooks/src/lifecycle_outbox.rs` (docs/deepseek-integration.md).
export type OutboxEventName = 'session_start' | 'session_end' | 'turn_start' | 'turn_end' | 'turn_stalled' | 'subagent_spawn' | 'subagent_complete'

const EVENTS = new Set<string>(['session_start', 'session_end', 'turn_start', 'turn_end', 'turn_stalled', 'subagent_spawn', 'subagent_complete'])
const THREAD_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SUB_ID = /^[A-Za-z0-9._:-]{1,64}$/
const SLUG = /^[A-Za-z0-9_-]{1,40}$/
const KIND = /^[a-z_]{1,24}\.[a-z_]{1,24}$/
const MAX_PATH = 1024

export type TurnOutcome = 'completed' | 'failed' | 'interrupted'
export type SubagentOutcome = 'completed' | 'error' | 'cancelled'

export interface OutboxEvent {
  event: OutboxEventName
  /** `turn.completed`, `turn.failed`…; only the fixed vocabulary is kept. */
  kind?: string
  threadId: string
  /** ISO time; the line's `timestamp`, else `created_at`. */
  at?: string
  workspace?: string
  subagent?: { id?: string; name?: string; outcome?: SubagentOutcome }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function isoOf(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000).toISOString()
  if (typeof v !== 'string' || v.length > 64) return undefined
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

function workspaceOf(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v || v.length > MAX_PATH || /[\u0000-\u001f\u007f]/.test(v)) return undefined
  return path.isAbsolute(v) || path.win32.isAbsolute(v) || path.posix.isAbsolute(v) ? v : undefined
}

const SUB_STATUS: Record<string, SubagentOutcome> = {
  completed: 'completed', complete: 'completed', success: 'completed', succeeded: 'completed', ok: 'completed', done: 'completed',
  failed: 'error', error: 'error', errored: 'error',
  cancelled: 'cancelled', canceled: 'cancelled', interrupted: 'cancelled', aborted: 'cancelled',
}

const pick = (o: Record<string, unknown>, keys: string[], re: RegExp): string | undefined => {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && re.test(v)) return v
  }
  return undefined
}

/** `payload.subagent` shape is undocumented: a bare id string or an object; ids and slug-like names only. */
function subagentOf(payload: Record<string, unknown>): OutboxEvent['subagent'] {
  const raw = payload.subagent
  const status = typeof payload.status === 'string' ? SUB_STATUS[payload.status.toLowerCase()] : undefined
  if (typeof raw === 'string') return { id: SUB_ID.test(raw) ? raw : undefined, outcome: status }
  if (!isRecord(raw)) return { outcome: status }
  const own = typeof raw.status === 'string' ? SUB_STATUS[raw.status.toLowerCase()] : undefined
  return {
    id: pick(raw, ['id', 'agent_id', 'subagent_id', 'thread_id'], SUB_ID),
    name: pick(raw, ['name', 'agent_type', 'type', 'role'], SLUG),
    outcome: own ?? status,
  }
}

/** One outbox line, or null (torn, foreign, unknown event, no session id). Free text in the payload is never kept. */
export function parseOutboxLine(record: unknown): OutboxEvent | null {
  if (!isRecord(record)) return null
  if (record.schema_version !== undefined && record.schema_version !== 1) return null
  const event = record.event
  if (typeof event !== 'string' || !EVENTS.has(event)) return null
  const threadId = record.thread_id
  // Fresh headless `exec` runs carry an empty thread id: nothing to key or resume them by.
  if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) return null
  const payload = isRecord(record.payload) ? record.payload : {}
  const out: OutboxEvent = {
    event: event as OutboxEventName,
    threadId,
    kind: typeof record.kind === 'string' && KIND.test(record.kind) ? record.kind : undefined,
    at: isoOf(record.timestamp) ?? isoOf(record.created_at),
    workspace: workspaceOf(payload.workspace),
  }
  if (event === 'subagent_spawn' || event === 'subagent_complete') out.subagent = subagentOf(payload)
  return out
}

export interface SubagentState {
  id: string
  name?: string
  startedAt?: string
  completedAt?: string
  outcome?: SubagentOutcome
}

export type StateChange =
  | { k: 'turn_start'; at?: string }
  | { k: 'turn_end'; outcome: TurnOutcome; at?: string }
  | { k: 'sub_spawn'; sub: SubagentState }
  | { k: 'sub_done'; sub: SubagentState }
  | { k: 'session_end'; at?: string }

const MAX_SUBAGENTS = 50

/** Lifecycle of one Codewhale session as the outbox tells it; counters, times and ids only. */
export class DeepseekThreadState {
  workspace?: string
  startedAt?: string
  sessionStartAt?: string
  lastAt?: string
  turnOpen = false
  stalled = false
  turnStartedAt?: string
  turnEndedAt?: string
  lastOutcome?: TurnOutcome
  turns = 0
  endedAt?: string
  readonly subagents = new Map<string, SubagentState>()
  private autoId = 0

  apply(e: OutboxEvent): StateChange[] {
    const at = e.at
    if (e.workspace) this.workspace = e.workspace
    if (at && (!this.startedAt || at < this.startedAt)) this.startedAt = at
    if (at && (!this.lastAt || at > this.lastAt)) this.lastAt = at
    switch (e.event) {
      case 'session_start':
        this.sessionStartAt = at
        // A resumed session starts again in a new process.
        this.endedAt = undefined
        return []
      case 'session_end':
        this.endedAt = at ?? this.lastAt ?? new Date().toISOString()
        this.turnOpen = false
        this.stalled = false
        return [{ k: 'session_end', at }]
      case 'turn_start':
        this.endedAt = undefined
        this.turnOpen = true
        this.stalled = false
        this.turnStartedAt = at
        this.turns++
        return [{ k: 'turn_start', at }]
      case 'turn_stalled':
        if (this.turnOpen) this.stalled = true
        return []
      case 'turn_end': {
        const outcome: TurnOutcome = e.kind === 'turn.failed' ? 'failed' : e.kind === 'turn.interrupted' ? 'interrupted' : 'completed'
        this.turnOpen = false
        this.stalled = false
        this.turnEndedAt = at
        this.lastOutcome = outcome
        return [{ k: 'turn_end', outcome, at }]
      }
      case 'subagent_spawn': {
        const id = e.subagent?.id ?? `n${++this.autoId}`
        const prev = this.subagents.get(id)
        const sub: SubagentState = { id, name: e.subagent?.name ?? prev?.name, startedAt: prev?.startedAt ?? at }
        this.subagents.set(id, sub)
        this.prune()
        return [{ k: 'sub_spawn', sub }]
      }
      case 'subagent_complete': {
        const id = e.subagent?.id ?? this.latestOpen()
        if (!id) return []
        const prev = this.subagents.get(id)
        const sub: SubagentState = { id, name: e.subagent?.name ?? prev?.name, startedAt: prev?.startedAt ?? at, completedAt: at ?? this.lastAt, outcome: e.subagent?.outcome ?? 'completed' }
        this.subagents.set(id, sub)
        this.prune()
        return [{ k: 'sub_done', sub }]
      }
    }
  }

  private latestOpen(): string | undefined {
    let best: SubagentState | undefined
    for (const s of this.subagents.values()) if (!s.outcome && (!best || (s.startedAt ?? '') >= (best.startedAt ?? ''))) best = s
    return best?.id
  }

  private prune(): void {
    if (this.subagents.size <= MAX_SUBAGENTS) return
    for (const [id, s] of this.subagents) {
      if (this.subagents.size <= MAX_SUBAGENTS) break
      if (s.outcome) this.subagents.delete(id)
    }
  }
}

/** `CODEWHALE_HOME`, else `~/.codewhale`, else the legacy `~/.deepseek` when only that one exists. */
export function codewhaleHome(env: NodeJS.ProcessEnv, exists: (dir: string) => boolean, home = os.homedir()): string {
  if (env.CODEWHALE_HOME) return env.CODEWHALE_HOME
  const main = path.join(home, '.codewhale')
  const legacy = path.join(home, '.deepseek')
  return !exists(main) && exists(legacy) ? legacy : main
}

function tomlString(raw: string): string | undefined {
  const v = raw.trim()
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1)
    return end > 0 ? v.slice(1, end) : undefined
  }
  if (!v.startsWith('"')) return undefined
  const m = /^"((?:[^"\\]|\\.)*)"/.exec(v)
  if (!m) return undefined
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return undefined
  }
}

/**
 * `[lifecycle_outbox] path` (or dotted `lifecycle_outbox.path` at top level) from config.toml text; nothing else is
 * read. `~` expands to the home dir, a relative path resolves against the Codewhale home. Null = outbox off.
 */
export function outboxPathFrom(toml: string | null, codewhaleDir: string, home = os.homedir()): string | null {
  if (!toml) return null
  let table = ''
  let found: string | undefined
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const header = /^\[\s*([^\]]+?)\s*\]\s*(#.*)?$/.exec(line)
    if (header) {
      table = header[1]!.replace(/\s+/g, '')
      continue
    }
    const kv = /^([A-Za-z0-9_."-]+?)\s*=\s*(.+)$/.exec(line)
    if (!kv) continue
    const key = (table ? `${table}.` : '') + kv[1]!.replace(/"/g, '')
    if (key === 'lifecycle_outbox.path') found = tomlString(kv[2]!)
  }
  if (!found || /[\u0000-\u001f]/.test(found)) return null
  if (found === '~' || found.startsWith('~/') || found.startsWith('~\\')) found = path.join(home, found.slice(1))
  return path.isAbsolute(found) ? path.normalize(found) : path.resolve(codewhaleDir, found)
}
