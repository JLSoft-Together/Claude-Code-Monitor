export const CONTEXT_WINDOW_DEFAULT = 200_000
export const CONTEXT_WINDOW_1M = 1_000_000
export const CONTEXT_THRESHOLDS = { notice: 60, warning: 80, critical: 95 } as const

// Share of the window kept free before auto-compact; same buffer math as the user's status line (gsd-statusline, #2219).
export const AUTOCOMPACT_BUFFER_PCT = 16.5

/** `CLAUDE_CODE_AUTO_COMPACT_WINDOW` turns into a buffer the way the status line does it (total falls back to 1M there too). */
export function autocompactBufferPct(autoCompactWindow?: number, total?: number): number {
  if (!autoCompactWindow || !(autoCompactWindow > 0)) return AUTOCOMPACT_BUFFER_PCT
  return Math.min(100, (autoCompactWindow / (total && total > 0 ? total : CONTEXT_WINDOW_1M)) * 100)
}

/** Raw window percent → percent of the room before auto-compact. */
export function usablePct(rawPct: number, bufferPct: number = AUTOCOMPACT_BUFFER_PCT): number {
  if (bufferPct >= 100) return 100
  return Math.max(0, Math.min(100, (rawPct / (100 - bufferPct)) * 100))
}

/** Percent of the usable window (before auto-compact) in use, matching the terminal status line. */
export function contextUsedPct(tokens: number, window: number, bufferPct?: number): number {
  return window > 0 ? usablePct((tokens / window) * 100, bufferPct) : 0
}

export function contextRawPct(tokens: number, window: number): number {
  return window > 0 ? Math.min(100, (tokens / window) * 100) : 0
}

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
