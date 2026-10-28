import type { TerminalSession } from '@ccm/shared'

export type InboxReason = 'waiting' | 'loop' | 'checks' | 'stuck' | 'done'

/** Lower = more urgent; one row per agent with its most urgent reason. */
export const SEVERITY: Record<InboxReason, number> = { waiting: 0, loop: 1, checks: 2, stuck: 3, done: 4 }

export interface InboxItem {
  id: string
  reason: InboxReason
  /** ISO time the reason started, for "· 4m". */
  since?: string
  /** Changes the row's dismiss stamp: a dismissed row comes back once this differs. */
  stamp: string
}

export interface InboxInput {
  terminals: readonly TerminalSession[]
  /** Terminal ids in an error loop, with the loop start. */
  loops: ReadonlyMap<string, { since: string }>
  /** Quiet-while-working ids (`quietFor` ≥ the stuck threshold). */
  stuck: ReadonlySet<string>
  /** Checkout roots whose last check failed. */
  failedRoots: readonly string[]
  /** Agents that finished out of sight (workspace pane `attention: 'done'`). */
  doneUnseen: ReadonlySet<string>
  /** id → stamp dismissed with E. */
  dismissed: Readonly<Record<string, string>>
}

const norm = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
const inside = (dir: string, root: string): boolean => norm(dir) === norm(root) || norm(dir).startsWith(`${norm(root)}\\`)

export function inboxItems(input: InboxInput): InboxItem[] {
  const out: InboxItem[] = []
  for (const x of input.terminals) {
    if (x.status === 'stale') continue
    const reasons: { reason: InboxReason; since?: string }[] = []
    if (x.status === 'waiting') reasons.push({ reason: 'waiting', since: x.statusSince })
    const loop = input.loops.get(x.id)
    if (loop) reasons.push({ reason: 'loop', since: loop.since })
    if (x.cwd && input.failedRoots.some((r) => inside(x.cwd!, r))) reasons.push({ reason: 'checks' })
    if (input.stuck.has(x.id)) reasons.push({ reason: 'stuck', since: x.lastActivityAt })
    if (input.doneUnseen.has(x.id) && x.status !== 'working') reasons.push({ reason: 'done', since: x.statusSince })
    const top = reasons.sort((a, b) => SEVERITY[a.reason] - SEVERITY[b.reason])[0]
    if (!top) continue
    const stamp = `${top.reason}|${x.status}|${x.statusSince ?? ''}`
    if (input.dismissed[x.id] === stamp) continue
    out.push({ id: x.id, reason: top.reason, since: top.since, stamp })
  }
  const at = (i: InboxItem): number => (i.since ? Date.parse(i.since) || Infinity : Infinity)
  return out.sort((a, b) => SEVERITY[a.reason] - SEVERITY[b.reason] || at(a) - at(b))
}

/** Dismiss stamps for agents no longer listed are dropped so the store does not grow. */
export function pruneDismissed(dismissed: Readonly<Record<string, string>>, liveIds: ReadonlySet<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(dismissed).filter(([id]) => liveIds.has(id)))
}
