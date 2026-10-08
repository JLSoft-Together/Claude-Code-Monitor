export const CONTEXT_WINDOW_DEFAULT = 200_000
export const CONTEXT_WINDOW_1M = 1_000_000
export const CONTEXT_THRESHOLDS = { notice: 60, warning: 80, critical: 95 } as const

export type ContextLevel = 'ok' | 'notice' | 'warning' | 'critical'

export function contextLevel(pct: number): ContextLevel {
  if (pct >= CONTEXT_THRESHOLDS.critical) return 'critical'
  if (pct >= CONTEXT_THRESHOLDS.warning) return 'warning'
  if (pct >= CONTEXT_THRESHOLDS.notice) return 'notice'
  return 'ok'
}

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'mythos'] as const

export function modelFamily(model: string | undefined): string | undefined {
  const m = model?.toLowerCase()
  return m ? FAMILIES.find((f) => m.includes(f)) : undefined
}

/**
 * Transcripts record the bare model id (no `[1m]`), so the 1M window is inferred from the
 * user's settings model alias (e.g. `opus[1m]`) or from a context already larger than 200k.
 */
export function contextWindowOf(
  model: string | undefined,
  hints: { settingsModel?: string; peak?: number; reported?: number; catalog?: number } = {},
): number | undefined {
  if (validWindow(hints.reported)) return hints.reported
  if (!model?.startsWith('claude-')) return undefined
  const guess = guessWindow(model, hints)
  return validWindow(hints.catalog) ? Math.max(hints.catalog, guess) : guess
}

function validWindow(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1_000 && n <= 100_000_000
}

function guessWindow(model: string, hints: { settingsModel?: string; peak?: number }): number {
  if (model.includes('[1m]')) return CONTEXT_WINDOW_1M
  const s = hints.settingsModel
  if (s?.includes('[1m]') && (modelFamily(s) === modelFamily(model) || model.startsWith(s.replace('[1m]', '')))) {
    return CONTEXT_WINDOW_1M
  }
  if ((hints.peak ?? 0) > CONTEXT_WINDOW_DEFAULT) return CONTEXT_WINDOW_1M
  return CONTEXT_WINDOW_DEFAULT
}
