import type { CacheTtl } from '@ccm/shared'

export type Signal =
  | { k: 'tool_use'; id: string; name: string; at?: string }
  | { k: 'tool_result'; toolUseId: string; isError: boolean; asyncLaunched: boolean; at?: string }
  | { k: 'turn_end'; at?: string }
  | { k: 'assistant_end'; at?: string }
  | { k: 'usage'; messageId: string; input: number; output: number; cacheRead: number; ttl?: CacheTtl; at?: string }
  | { k: 'model'; model: string; effort?: string }
  | { k: 'task_notification'; toolUseId?: string; taskId?: string; status: string; at?: string }
  | { k: 'seen'; at: string }
  | { k: 'compact'; trigger?: string; preTokens?: number; postTokens?: number; at?: string }
  | { k: 'permission_mode'; mode: string }
  | { k: 'branch'; branch: string }

type Obj = Record<string, unknown>

const EFFORT_RE = /^[a-z]{2,12}$/

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

const MAX_ENUM = 120

const NOTIFICATION_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g

function tag(body: string, name: string): string | undefined {
  const m = body.match(new RegExp(`<${name}>([^<]{1,200})</${name}>`))
  return m?.[1]?.trim()
}

export function parseTaskNotifications(text: string, at: string | undefined): Signal[] {
  if (!text.includes('<task-notification>')) return []
  const out: Signal[] = []
  for (const m of text.matchAll(NOTIFICATION_RE)) {
    const body = m[1] ?? ''
    const status = tag(body, 'status')
    if (!status) continue
    out.push({ k: 'task_notification', toolUseId: tag(body, 'tool-use-id'), taskId: tag(body, 'task-id'), status, at })
  }
  return out
}

function textsOf(content: unknown): string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const b of content) if (isObj(b) && b.type === 'text' && typeof b.text === 'string') out.push(b.text)
  return out
}

export function extractSignals(rec: unknown): Signal[] {
  if (!isObj(rec)) return []
  const type = rec.type
  const at = str(rec.timestamp)
  const out: Signal[] = []
  const branch = str(rec.gitBranch)
  if (branch) out.push({ k: 'branch', branch: branch.slice(0, MAX_ENUM) })

  if (type === 'permission-mode' && typeof rec.permissionMode === 'string') {
    out.push({ k: 'permission_mode', mode: rec.permissionMode.slice(0, MAX_ENUM) })
    return out
  }

  if (type === 'assistant' && isObj(rec.message)) {
    const msg = rec.message
    if (at) out.push({ k: 'seen', at })
    const model = str(msg.model)
    const effort = str(rec.effort) ?? str(rec.perTurnEffort)
    if (model && model !== '<synthetic>') out.push({ k: 'model', model, effort: effort && EFFORT_RE.test(effort) ? effort : undefined })
    const id = str(msg.id)
    if (id && isObj(msg.usage)) {
      const u = msg.usage
      const creation = isObj(u.cache_creation) ? u.cache_creation : {}
      const ttl: CacheTtl | undefined =
        int(creation.ephemeral_1h_input_tokens) > 0 ? '1h' : int(creation.ephemeral_5m_input_tokens) > 0 ? '5m' : undefined
      out.push({
        k: 'usage',
        messageId: id,
        input: int(u.input_tokens) + int(u.cache_creation_input_tokens),
        output: int(u.output_tokens),
        cacheRead: int(u.cache_read_input_tokens),
        ttl,
        at,
      })
    }
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (isObj(b) && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
          out.push({ k: 'tool_use', id: b.id, name: b.name, at })
        }
      }
    }
    if (msg.stop_reason === 'end_turn') out.push({ k: 'assistant_end', at })
    return out
  }

  if (type === 'user' && isObj(rec.message)) {
    if (at) out.push({ k: 'seen', at })
    const content = rec.message.content
    const asyncLaunched = isObj(rec.toolUseResult) && rec.toolUseResult.status === 'async_launched'
    if (Array.isArray(content)) {
      for (const b of content) {
        if (isObj(b) && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          out.push({ k: 'tool_result', toolUseId: b.tool_use_id, isError: b.is_error === true, asyncLaunched, at })
        }
      }
    }
    for (const t of textsOf(content)) out.push(...parseTaskNotifications(t, at))
    return out
  }

  if (type === 'queue-operation' && typeof rec.content === 'string') {
    return parseTaskNotifications(rec.content, at)
  }

  if (type === 'system' && rec.subtype === 'turn_duration') {
    out.push({ k: 'turn_end', at })
    return out
  }

  if (type === 'system' && rec.subtype === 'compact_boundary') {
    const meta = isObj(rec.compactMetadata) ? rec.compactMetadata : {}
    out.push({
      k: 'compact',
      trigger: str(meta.trigger)?.slice(0, MAX_ENUM),
      preTokens: typeof meta.preTokens === 'number' ? int(meta.preTokens) : undefined,
      postTokens: typeof meta.postTokens === 'number' ? int(meta.postTokens) : undefined,
      at,
    })
    return out
  }

  return out
}

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
}

export class TranscriptState {
  readonly openTools = new Map<string, string>()
  private readonly usage = new Map<string, UsageTotals>()
  model?: string
  effort?: string
  cacheTtl?: CacheTtl
  cacheAt?: string
  lastAt?: string
  contextTokens?: number
  peakContext = 0
  compactions = 0
  permissionMode?: string
  gitBranch?: string
  ended = false
  lastEndAt?: string

  apply(signals: Signal[]): void {
    for (const s of signals) {
      switch (s.k) {
        case 'seen':
          this.lastAt = s.at
          break
        case 'model':
          this.model = s.model
          this.effort = s.effort
          break
        case 'usage':
          this.usage.set(s.messageId, { input: s.input, output: s.output, cacheRead: s.cacheRead })
          this.contextTokens = s.input + s.cacheRead
          this.peakContext = Math.max(this.peakContext, this.contextTokens)
          // A read-only reply carries no tier; it still refreshes the cache, so keep the last written tier.
          if (s.ttl) this.cacheTtl = s.ttl
          if (s.at) this.cacheAt = s.at
          break
        case 'compact':
          this.compactions++
          if (s.postTokens !== undefined) this.contextTokens = s.postTokens
          break
        case 'permission_mode':
          this.permissionMode = s.mode
          break
        case 'branch':
          this.gitBranch = s.branch
          break
        case 'tool_use':
          this.openTools.set(s.id, s.name)
          this.ended = false
          break
        case 'tool_result':
          this.openTools.delete(s.toolUseId)
          this.ended = false
          break
        case 'turn_end':
          this.openTools.clear()
          break
        case 'assistant_end':
          this.ended = true
          this.lastEndAt = s.at
          break
        default:
          break
      }
    }
  }

  currentTool(): string | undefined {
    let last: string | undefined
    for (const name of this.openTools.values()) last = name
    return last
  }

  tokens(): UsageTotals | undefined {
    if (this.usage.size === 0) return undefined
    let input = 0
    let output = 0
    let cacheRead = 0
    for (const u of this.usage.values()) {
      input += u.input
      output += u.output
      cacheRead += u.cacheRead
    }
    return { input, output, cacheRead }
  }
}
