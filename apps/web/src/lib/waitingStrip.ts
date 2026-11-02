import type { TerminalSession } from '@ccm/shared'

export interface WaitingSummary {
  /** Waiting sessions plus blocked jobs that are not snoozed: the N of "Needs you · N". */
  count: number
  /** The live waiting session that has waited longest (snoozed ones are skipped). */
  oldest: { id: string; since: number } | null
}

/** What the thin strip over the collapsed Session column shows. */
export function waitingSummary(
  live: readonly Pick<TerminalSession, 'id' | 'status' | 'statusSince'>[],
  blockedJobs: number,
  isSnoozed: (id: string) => boolean,
): WaitingSummary {
  let count = blockedJobs
  let oldest: WaitingSummary['oldest'] = null
  for (const s of live) {
    if (s.status !== 'waiting' || isSnoozed(s.id)) continue
    count++
    const since = s.statusSince ? Date.parse(s.statusSince) : NaN
    if (Number.isFinite(since) && (!oldest || since < oldest.since)) oldest = { id: s.id, since }
  }
  return { count, oldest }
}
