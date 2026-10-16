import type { RunBadge } from '../runUi'
import { needsUser, type RailCluster } from './railModel'

export interface AttentionEntry {
  paneKey: string
  tabKey: string
  state: 'failed' | 'asked'
  first: string
  agent: string
  place: string
  branch: string | null
  run: RunBadge | null
  since: number
}

export interface AttentionList {
  entries: AttentionEntry[]
  footer: Record<'working' | 'done' | 'idle' | 'ended', number>
}

/** Failed before asked, oldest first; everyone else only counted in the footer. */
export function buildAttentionList(clusters: readonly RailCluster[]): AttentionList {
  const entries: AttentionEntry[] = []
  const footer = { working: 0, done: 0, idle: 0, ended: 0 }
  for (const c of clusters)
    for (const k of c.checkouts)
      for (const r of k.rows) {
        if (needsUser(r.state))
          entries.push({ paneKey: r.paneKey, tabKey: r.tabKey, state: r.state as 'failed' | 'asked', first: r.task ?? r.ordinal, agent: r.agent, place: c.name, branch: k.branch, run: r.run, since: r.since })
        else if (r.state === 'subagents') footer.working++
        else if (r.state === 'working' || r.state === 'done' || r.state === 'ended') footer[r.state]++
        else footer.idle++
      }
  const loud = (e: AttentionEntry): number => (e.state === 'failed' ? 0 : 1)
  entries.sort((a, b) => loud(a) - loud(b) || (a.since || Infinity) - (b.since || Infinity))
  return { entries, footer }
}
