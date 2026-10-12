import type { LimitWindow } from '@ccm/shared'

export type CodexMode = 'exec' | 'tui' | 'plugin' | 'subagent' | 'app-server'

export interface CodexMeta {
  id: string
  /** Thread creation time (ms), used to pair the thread with its process. */
  createdAt: number
  cwd?: string
  originator?: string
  source?: string
  parentThreadId?: string
  version?: string
}

export interface TokenUsage {
  input: number
  cached: number
  output: number
  total: number
}

export interface CodexLimits {
  fiveHour?: LimitWindow
  sevenDay?: LimitWindow
  plan?: string
  at: string
}

export type CodexSignal =
  | { k: 'meta'; meta: CodexMeta }
  | { k: 'context'; model?: string; effort?: string }
  | { k: 'turn_start'; at?: string; contextWindow?: number }
  | { k: 'turn_end'; at?: string; aborted: boolean }
  | { k: 'tool_call'; id: string; name: string; at?: string }
  | { k: 'tool_output'; id: string }
  | { k: 'tokens'; total: TokenUsage; last?: TokenUsage; contextWindow?: number }
  | { k: 'limits'; limits: CodexLimits }
  | { k: 'compact' }
  | { k: 'seen'; at: string }

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
const MAX_ENUM = 80
const ENUM_RE = /^[\w.:/@+-]{1,80}$/
const enumOf = (v: unknown): string | undefined => {
  const s = str(v)
  return s && ENUM_RE.test(s) ? s : undefined
}

const KEEP_EVENTS = new Set(['task_started', 'task_complete', 'turn_aborted', 'token_count', 'context_compacted'])
const KEEP_ITEMS = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'function_call_output', 'custom_tool_call_output'])
const KEEP_TOP = new Set(['session_meta', 'turn_context'])
const HEAD_TYPES = /"type":"(\w+)"(?:,"payload":\{"type":"(\w+)")?/

export type LineClass = 'parse' | 'skip' | 'compacted'

/**
 * Decides from the first bytes of a rollout line whether it is worth parsing. Message, reasoning, image and compaction
 * lines can be megabytes and carry session content we never read. A head we cannot classify is parsed (format drift).
 */
export function classifyLine(head: string): LineClass {
  const m = HEAD_TYPES.exec(head)
  if (!m) return 'parse'
  const top = m[1]!
  if (KEEP_TOP.has(top)) return 'parse'
  if (top === 'compacted') return 'compacted'
  if (top === 'event_msg') return m[2] === undefined || KEEP_EVENTS.has(m[2]) ? 'parse' : 'skip'
  if (top === 'response_item') return m[2] === undefined || KEEP_ITEMS.has(m[2]) ? 'parse' : 'skip'
  return 'skip'
}

function usageOf(v: unknown): TokenUsage | undefined {
  if (!isObj(v)) return undefined
  const input = int(v.input_tokens)
  const cached = Math.min(int(v.cached_input_tokens), input)
  const output = int(v.output_tokens)
  return { input, cached, output, total: int(v.total_tokens) || input + output }
}

function findParentThread(v: unknown, depth = 0): string | undefined {
  if (!isObj(v) || depth > 4) return undefined
  const direct = enumOf(v.parent_thread_id)
  if (direct) return direct
  for (const child of Object.values(v)) {
    const found = findParentThread(child, depth + 1)
    if (found) return found
  }
  return undefined
}

export function metaOf(payload: unknown): CodexMeta | null {
  if (!isObj(payload)) return null
  const id = enumOf(payload.id) ?? enumOf(payload.session_id)
  const createdAt = Date.parse(str(payload.timestamp) ?? '')
  if (!id || !Number.isFinite(createdAt)) return null
  const source = payload.source
  return {
    id,
    createdAt,
    cwd: str(payload.cwd)?.slice(0, 1024),
    originator: str(payload.originator)?.slice(0, MAX_ENUM),
    source: typeof source === 'string' ? source.slice(0, MAX_ENUM) : isObj(source) ? 'subagent' : undefined,
    parentThreadId: findParentThread(source),
    version: enumOf(payload.cli_version),
  }
}

function windowOf(v: unknown): { minutes: number; window: LimitWindow } | undefined {
  if (!isObj(v) || typeof v.used_percent !== 'number' || !Number.isFinite(v.used_percent)) return undefined
  const reset = typeof v.resets_at === 'number' && v.resets_at > 0 ? new Date(v.resets_at * 1000).toISOString() : undefined
  return { minutes: int(v.window_minutes), window: { usedPct: Math.max(0, Math.min(100, v.used_percent)), resetsAt: reset } }
}

function limitsOf(v: unknown, at: string | undefined): CodexLimits | undefined {
  if (!isObj(v) || !at) return undefined
  if (v.limit_id !== undefined && v.limit_id !== null && v.limit_id !== 'codex') return undefined
  const out: CodexLimits = { at, plan: enumOf(v.plan_type) }
  for (const w of [windowOf(v.primary), windowOf(v.secondary)]) {
    if (!w) continue
    if (w.minutes > 0 && w.minutes <= 24 * 60) out.fiveHour = w.window
    else if (w.minutes > 24 * 60) out.sevenDay = w.window
  }
  return out.fiveHour || out.sevenDay ? out : undefined
}

export function extractCodexSignals(rec: unknown): CodexSignal[] {
  if (!isObj(rec) || !isObj(rec.payload)) return []
  const p = rec.payload
  const at = str(rec.timestamp)
  const out: CodexSignal[] = []
  if (at) out.push({ k: 'seen', at })
  switch (rec.type) {
    case 'session_meta': {
      const meta = metaOf(p)
      if (meta) out.push({ k: 'meta', meta })
      break
    }
    case 'turn_context': {
      const settings = isObj(p.collaboration_mode) && isObj(p.collaboration_mode.settings) ? p.collaboration_mode.settings : {}
      out.push({ k: 'context', model: enumOf(p.model) ?? enumOf(settings.model), effort: enumOf(p.effort) ?? enumOf(settings.reasoning_effort) })
      break
    }
    case 'compacted':
      out.push({ k: 'compact' })
      break
    case 'event_msg':
      switch (p.type) {
        case 'task_started':
          out.push({ k: 'turn_start', at, contextWindow: int(p.model_context_window) || undefined })
          break
        case 'task_complete':
          out.push({ k: 'turn_end', at, aborted: false })
          break
        case 'turn_aborted':
          out.push({ k: 'turn_end', at, aborted: true })
          break
        case 'context_compacted':
          out.push({ k: 'compact' })
          break
        case 'token_count': {
          const info = isObj(p.info) ? p.info : undefined
          const total = usageOf(info?.total_token_usage)
          if (total) out.push({ k: 'tokens', total, last: usageOf(info?.last_token_usage), contextWindow: int(info?.model_context_window) || undefined })
          const limits = limitsOf(p.rate_limits, at)
          if (limits) out.push({ k: 'limits', limits })
          break
        }
      }
      break
    case 'response_item': {
      const id = str(p.call_id)
      if (!id) break
      if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') out.push({ k: 'tool_output', id })
      else if (p.type === 'local_shell_call') out.push({ k: 'tool_call', id, name: 'shell', at })
      else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        const name = enumOf(p.namespace) && enumOf(p.name) ? `${p.namespace}.${p.name}` : enumOf(p.name)
        if (name) out.push({ k: 'tool_call', id, name: name.slice(0, MAX_ENUM), at })
      }
      break
    }
  }
  return out
}

export class CodexThreadState {
  meta?: CodexMeta
  model?: string
  effort?: string
  /** undefined until a turn marker or turn activity was seen (reading may start mid-file). */
  turnOpen?: boolean
  aborted = false
  turnStartedAt?: string
  turnEndedAt?: string
  readonly openCalls = new Map<string, string>()
  total?: TokenUsage
  last?: TokenUsage
  contextWindow?: number
  limits?: CodexLimits
  lastAt?: string
  compactions = 0

  apply(signals: CodexSignal[]): void {
    for (const s of signals) {
      switch (s.k) {
        case 'seen':
          if (!this.lastAt || s.at > this.lastAt) this.lastAt = s.at
          break
        case 'meta':
          this.meta ??= s.meta
          break
        case 'context':
          if (s.model) this.model = s.model
          if (s.effort) this.effort = s.effort
          break
        case 'turn_start':
          this.turnOpen = true
          this.aborted = false
          this.turnStartedAt = s.at
          this.openCalls.clear()
          if (s.contextWindow) this.contextWindow = s.contextWindow
          break
        case 'turn_end':
          this.turnOpen = false
          this.aborted = s.aborted
          this.turnEndedAt = s.at
          this.openCalls.clear()
          break
        case 'tool_call':
          this.openCalls.set(s.id, s.name)
          this.turnOpen ??= true
          break
        case 'tool_output':
          this.openCalls.delete(s.id)
          break
        case 'tokens':
          this.total = s.total
          if (s.last) this.last = s.last
          if (s.contextWindow) this.contextWindow = s.contextWindow
          this.turnOpen ??= true
          break
        case 'limits':
          if (!this.limits || s.limits.at >= this.limits.at) this.limits = s.limits
          break
        case 'compact':
          this.compactions++
          break
      }
    }
  }

  currentTool(): string | undefined {
    let last: string | undefined
    for (const name of this.openCalls.values()) last = name
    return last
  }
}

/** Interactive-vs-batch role of a thread; Codex Desktop / IDE threads return null (out of scope). */
export function modeOf(meta: CodexMeta): CodexMode | null {
  if (meta.parentThreadId || meta.source === 'subagent') return 'subagent'
  if (meta.originator === 'Claude Code') return 'plugin'
  if (meta.source === 'exec') return 'exec'
  if (meta.source === 'cli') return 'tui'
  if (meta.source === 'vscode') return null
  return 'app-server'
}
