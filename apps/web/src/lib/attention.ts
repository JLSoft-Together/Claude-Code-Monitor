import { priceOf, type ActivityEvent, type Agent, type TerminalSession } from '@ccm/shared'

const TTL_MS = { '5m': 5 * 60_000, '1h': 3_600_000 } as const

const parse = (iso: string | undefined) => {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : null
}

/** Ms since the last transcript line of a working session once past the threshold, else null. */
export function quietFor(terminal: TerminalSession, nowMs: number, thresholdMin: number): number | null {
  if (thresholdMin <= 0 || terminal.status !== 'working') return null
  const last = parse(terminal.lastActivityAt)
  if (last === null) return null
  const quiet = nowMs - last
  return quiet >= thresholdMin * 60_000 ? quiet : null
}

export interface CacheState {
  expiresAt: number
  expired: boolean
  /** Extra USD the next prompt pays to rewrite the prefix instead of reading it (API list price). */
  extraCost: number | null
  tokens: number
}

/** Prompt-cache expiry for an agent that is not running (only then can the cache go cold). */
export function cacheState(agent: Agent | undefined, terminal: TerminalSession, nowMs: number): CacheState | null {
  if (!agent || (terminal.status !== 'waiting' && terminal.status !== 'idle')) return null
  const at = parse(agent.cacheAt)
  const tokens = agent.contextTokens
  if (at === null || !agent.cacheTtl || !tokens) return null
  const expiresAt = at + TTL_MS[agent.cacheTtl]
  const price = agent.model ? priceOf(agent.model) : null
  const write = price ? (agent.cacheTtl === '1h' ? price.cacheWrite1h : price.cacheWrite5m) : 0
  return {
    expiresAt,
    expired: nowMs >= expiresAt,
    extraCost: price ? (tokens * (write - price.cacheRead)) / 1_000_000 : null,
    tokens,
  }
}

export function formatUsd(value: number): string {
  return value < 0.01 ? '<$0.01' : `$${value.toFixed(value < 10 ? 2 : 1)}`
}

export interface ErrorLoop {
  failures: number
  calls: number
  /** Tool that failed most in the window. */
  tool: string | null
  /** Oldest failure in the window (episode key). */
  since: string
}

export const LOOP_WINDOW_MS = 5 * 60_000
export const LOOP_MIN_FAILURES = 5

/** Sessions burning turns on failing tools: ≥ 5 failures in 5 minutes and at least half of their tool calls. */
export function errorLoops(items: ActivityEvent[], nowMs: number): Map<string, ErrorLoop> {
  const acc = new Map<string, { failures: number; calls: number; tools: Map<string, number>; since: string }>()
  for (const e of items) {
    if (!e.terminalId || (e.kind !== 'tool.started' && e.kind !== 'tool.failed')) continue
    const at = Date.parse(e.at)
    if (!Number.isFinite(at) || nowMs - at > LOOP_WINDOW_MS) continue
    let a = acc.get(e.terminalId)
    if (!a) acc.set(e.terminalId, (a = { failures: 0, calls: 0, tools: new Map(), since: '' }))
    if (e.kind === 'tool.started') {
      a.calls++
      continue
    }
    a.failures++
    if (!a.since || e.at < a.since) a.since = e.at
    const tool = e.data?.tool ?? ''
    a.tools.set(tool, (a.tools.get(tool) ?? 0) + 1)
  }
  const out = new Map<string, ErrorLoop>()
  for (const [id, a] of acc) {
    if (a.failures < LOOP_MIN_FAILURES || a.failures * 2 < a.calls) continue
    const top = [...a.tools].sort((x, y) => y[1] - x[1])[0]?.[0]
    out.set(id, { failures: a.failures, calls: Math.max(a.calls, a.failures), tool: top || null, since: a.since })
  }
  return out
}
