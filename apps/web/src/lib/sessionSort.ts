import type { TerminalSession, TerminalStatus } from '@ccm/shared'
import { displayTitle } from './title'

export type SessionSort = 'activity' | 'started' | 'status' | 'name'
export const SESSION_SORTS: SessionSort[] = ['activity', 'started', 'status', 'name']

const STATUS_RANK: Record<TerminalStatus, number> = { waiting: 0, error: 1, working: 2, idle: 3, unknown: 4, stale: 5 }

const time = (iso: string | undefined) => {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : 0
}

// Minute buckets: per-line timestamps would reshuffle cards on every transcript write.
const minute = (iso: string | undefined) => Math.floor(time(iso) / 60_000)

/** Pinned first, ended always last; ties fall back to the stable id order. */
export function sortSessions(list: readonly TerminalSession[], by: SessionSort, pinned: ReadonlySet<string> = new Set()): TerminalSession[] {
  const compare = (a: TerminalSession, b: TerminalSession): number => {
    switch (by) {
      case 'activity':
        return minute(b.lastActivityAt ?? b.startedAt) - minute(a.lastActivityAt ?? a.startedAt)
      case 'started':
        return time(b.startedAt) - time(a.startedAt)
      case 'status':
        return STATUS_RANK[a.status] - STATUS_RANK[b.status] || minute(b.lastActivityAt) - minute(a.lastActivityAt)
      case 'name':
        return displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base', numeric: true })
    }
  }
  const rank = (x: TerminalSession) => (x.status === 'stale' ? 2 : pinned.has(x.id) ? 0 : 1)
  return [...list].sort((a, b) => rank(a) - rank(b) || compare(a, b) || a.id.localeCompare(b.id))
}

export function readSessionSort(): SessionSort {
  try {
    const v = localStorage.getItem('ccm.sessionSort')
    return (SESSION_SORTS as string[]).includes(v ?? '') ? (v as SessionSort) : 'activity'
  } catch {
    return 'activity'
  }
}

export function saveSessionSort(value: SessionSort): void {
  try {
    localStorage.setItem('ccm.sessionSort', value)
  } catch {
    return
  }
}
