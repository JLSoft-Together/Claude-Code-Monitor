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

export interface LimitRisk {
  provider: Provider
  key: LimitKey
  fullAtMs: number
}

/**
 * Earliest window the forecast says will fill before it resets. Only real forecast data counts, and a stale report
 * is skipped because its projection is out of date; `withinMs` narrows it to "soon".
 */
export function limitRisk(
  claude: PlanLimits | null | undefined,
  codex: PlanLimits | null | undefined,
  nowMs: number,
  withinMs = Infinity,
  only?: Provider,
): LimitRisk | null {
  let best: LimitRisk | null = null
  const sources: [Provider, PlanLimits | null | undefined][] = [
    ['claude', claude],
    ['codex', codex],
  ]
  for (const [provider, limits] of sources) {
    if (!limits || (only && provider !== only) || limitsStale(limits, nowMs)) continue
    for (const key of ['fiveHour', 'sevenDay'] as const) {
      const w = limits[key]
      const f = w?.forecast
      const fullAtMs = f?.fullAt ? Date.parse(f.fullAt) : NaN
      if (!w || !f || f.beforeReset !== true || !Number.isFinite(w.usedPct) || w.usedPct >= 100) continue
      if (!Number.isFinite(fullAtMs) || fullAtMs <= nowMs || fullAtMs - nowMs > withinMs) continue
      if (!best || fullAtMs < best.fullAtMs) best = { provider, key, fullAtMs }
    }
  }
  return best
}

export function limitsStale(limits: PlanLimits | null | undefined, nowMs: number): boolean {
  const at = limits ? Date.parse(limits.updatedAt) : NaN
  return Number.isFinite(at) && nowMs - at > LIMITS_STALE_MS
}
