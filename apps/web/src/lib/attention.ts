import { priceOf, type Agent, type TerminalSession } from '@ccm/shared'

const TTL_MS = { '5m': 5 * 60_000, '1h': 3_600_000 } as const

const parse = (iso: string | undefined) => {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : null
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

export { LOOP_MIN_FAILURES, LOOP_WINDOW_MS, errorLoops, quietFor, type ErrorLoop } from '@ccm/shared'
