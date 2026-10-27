import type { TerminalSession } from '@ccm/shared'
import { dirKey } from '../stores/favorites'
import { isTerm, workCwd, type Pane } from '../stores/workspace'

// Worktrees live in `<repo>-wt/<branch>`, so they fold back under the repo they came from.
const WT = /^(.*[\\/])([^\\/]+)-wt[\\/][^\\/]+(?:[\\/].*)?$/

export const folderName = (dir: string): string => dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir

export function projectOf(dir: string | undefined): string | null {
  if (!dir) return null
  const m = WT.exec(dir)
  return m ? `${m[1]}${m[2]}` : dir
}

/** Deepest known git toplevel holding `dir` (or equal to it); dirKey compare, so case-insensitive. */
export function containingRoot(dir: string, repoRoots: Iterable<string>): string | undefined {
  const key = dirKey(dir)
  let best: string | undefined
  let bestLen = -1
  for (const root of repoRoots) {
    const r = dirKey(root)
    if ((key === r || key.startsWith(r + '\\')) && r.length > bestLen) {
      best = root
      bestLen = r.length
    }
  }
  return best
}

export type RowStatus = { kind: 'status'; status: string; label: string } | { kind: 'starting'; label: string } | null

type SessionInfo = Pick<TerminalSession, 'status'>

/** Glyph + i18n key for a row; null for viewer panes, which have no lifecycle. */
export function rowStatus(pane: Pane, session: SessionInfo | undefined): RowStatus {
  if (!isTerm(pane)) return null
  if (pane.state === 'parked') return { kind: 'status', status: 'stale', label: 'workspace.state.parked' }
  if (pane.state === 'starting') return { kind: 'starting', label: 'workspace.state.starting' }
  if (pane.state === 'exited') return { kind: 'status', status: 'completed', label: 'workspace.state.exited' }
  if (pane.state === 'error' || pane.state === 'gone') return { kind: 'status', status: 'error', label: 'workspace.state.error' }
  if (pane.attention === 'waiting') return { kind: 'status', status: 'waiting', label: 'workspace.attention.waiting' }
  if (session) {
    if (pane.attention === 'done' && session.status === 'idle') return { kind: 'status', status: 'completed', label: 'workspace.attention.done' }
    return { kind: 'status', status: session.status, label: `status.${session.status}` }
  }
  return { kind: 'status', status: 'idle', label: 'workspace.state.running' }
}

/** Shell rows: the script started from the menu, else the folder it sits in. Never guessed from output. */
export function shellTitle(pane: Pane): string | undefined {
  if (pane.command) return pane.command
  const dir = workCwd(pane)
  return dir ? folderName(dir) : undefined
}

/** Last sign of life: the session's own activity time, else output / input / focus seen in this window. */
export function rowActivity(pane: Pane, session: Pick<TerminalSession, 'lastActivityAt'> | undefined, seen: number | undefined): number | undefined {
  const at = session?.lastActivityAt ? Date.parse(session.lastActivityAt) : NaN
  const times = [Number.isFinite(at) ? at : undefined, seen, pane.focusedAt].filter((v): v is number => typeof v === 'number')
  return times.length ? Math.max(...times) : undefined
}

export type Age = { unit: 'now' } | { unit: 'm' | 'h' | 'd'; n: number }

export function shortAge(at: number, now: number): Age {
  const sec = Math.max(0, (now - at) / 1000)
  if (sec < 60) return { unit: 'now' }
  if (sec < 3600) return { unit: 'm', n: Math.floor(sec / 60) }
  if (sec < 86400) return { unit: 'h', n: Math.floor(sec / 3600) }
  return { unit: 'd', n: Math.floor(sec / 86400) }
}
