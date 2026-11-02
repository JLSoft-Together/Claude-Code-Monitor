import type { PlanLimits, Provider } from '@ccm/shared'

export const LIMIT_ALERT_LEFT = 10
export const LIMIT_WARN_LEFT = 20
export const LIMITS_STALE_MS = 30 * 60_000

export type LimitKey = 'fiveHour' | 'sevenDay'
export type LimitLevel = 'ok' | 'warn' | 'critical'

export interface WorstLimit {
  provider: Provider
  key: LimitKey
  left: number
  level: LimitLevel
}

export const limitLevel = (left: number): LimitLevel => (left <= LIMIT_ALERT_LEFT ? 'critical' : left <= LIMIT_WARN_LEFT ? 'warn' : 'ok')

/** Lowest remaining percentage across Claude and Codex windows; null when no window reports (never an invented number). */
export function worstLimit(claude: PlanLimits | null | undefined, codex: PlanLimits | null | undefined): WorstLimit | null {
  let best: WorstLimit | null = null
  const sources: [Provider, PlanLimits | null | undefined][] = [
    ['claude', claude],
    ['codex', codex],
  ]
  for (const [provider, limits] of sources) {
    if (!limits) continue
    for (const key of ['fiveHour', 'sevenDay'] as const) {
      const w = limits[key]
      if (!w || !Number.isFinite(w.usedPct)) continue
      const left = Math.max(0, 100 - Math.round(w.usedPct))
      if (!best || left < best.left) best = { provider, key, left, level: limitLevel(left) }
    }
  }
  return best
}

export function limitsStale(limits: PlanLimits | null | undefined, nowMs: number): boolean {
  const at = limits ? Date.parse(limits.updatedAt) : NaN
  return Number.isFinite(at) && nowMs - at > LIMITS_STALE_MS
}
