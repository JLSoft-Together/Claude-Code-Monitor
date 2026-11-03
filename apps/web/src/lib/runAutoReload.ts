import type { RunSession, TerminalStatus } from '@ccm/shared'

export const AUTO_RELOAD_DEBOUNCE_MS = 2000
export const AUTO_RELOAD_MIN_GAP_MS = 8000

export interface AgentStatusRow {
  id: string
  status: TerminalStatus
}

/**
 * Updates `prev` with the rows and returns the agents that just finished a turn cleanly (working → idle).
 * working → error / waiting / stale never counts: a failed or blocked agent leaves the app as it is.
 */
export function agentsFinished(prev: Map<string, TerminalStatus>, rows: readonly AgentStatusRow[]): string[] {
  const finished: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    seen.add(r.id)
    if (prev.get(r.id) === 'working' && r.status === 'idle') finished.push(r.id)
    prev.set(r.id, r.status)
  }
  for (const id of [...prev.keys()]) if (!seen.has(id)) prev.delete(id)
  return finished
}

export type AutoReloadAction = 'reload' | 'rerun' | null

/** Mirrors the Run bar: Flutter debug / appId sessions hot reload, Android reruns, anything else is left alone. */
export function autoReloadAction(s: RunSession | null): AutoReloadAction {
  if (!s || s.state !== 'running') return null
  if ((s.type === 'flutter' && s.mode === 'debug') || (s.type === 'custom' && !!s.appId)) return 'reload'
  if (s.type === 'android') return 'rerun'
  return null
}
