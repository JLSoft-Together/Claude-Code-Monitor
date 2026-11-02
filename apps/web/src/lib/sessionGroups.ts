import type { TerminalSession, TerminalStatus } from '@ccm/shared'

export type SessionGroupKey = 'needs' | 'running' | 'idle' | 'ended'

export interface SessionGroup {
  key: SessionGroupKey
  ids: string[]
}

export const GROUP_ORDER: SessionGroupKey[] = ['needs', 'running', 'idle', 'ended']

// An errored session has stopped and waits for no answer, so it reads as idle; its status icon still shows the error.
const GROUP_OF: Record<TerminalStatus, SessionGroupKey> = {
  waiting: 'needs',
  working: 'running',
  idle: 'idle',
  error: 'idle',
  unknown: 'idle',
  stale: 'ended',
}

export function groupOf(status: TerminalStatus): SessionGroupKey {
  return GROUP_OF[status] ?? 'idle'
}

/** Splits an already sorted list by what each session needs; order inside a group is the order given. Empty groups are dropped. */
export function groupSessions(sorted: readonly Pick<TerminalSession, 'id' | 'status'>[]): SessionGroup[] {
  const by: Record<SessionGroupKey, string[]> = { needs: [], running: [], idle: [], ended: [] }
  for (const s of sorted) by[groupOf(s.status)].push(s.id)
  return GROUP_ORDER.filter((key) => by[key].length > 0).map((key) => ({ key, ids: by[key] }))
}

export function sameSessionGroups(a: readonly SessionGroup[] | undefined, b: readonly SessionGroup[]): boolean {
  return (
    !!a &&
    a.length === b.length &&
    a.every((g, i) => g.key === b[i]!.key && g.ids.length === b[i]!.ids.length && g.ids.every((id, j) => id === b[i]!.ids[j]))
  )
}
