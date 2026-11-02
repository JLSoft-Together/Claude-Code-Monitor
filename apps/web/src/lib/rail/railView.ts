import { isBusyState, needsUser, rowLines, type RailCheckout, type RailCluster, type RailRow } from './railModel'

export interface RailSections {
  /** Live projects with a running, starting or waiting pane. */
  agents: RailCluster[]
  /** Live projects with nothing going on. */
  opened: RailCluster[]
  /** Remembered projects with no pane. */
  others: RailCluster[]
}

export const hasAgentWork = (c: RailCluster): boolean =>
  c.live && c.checkouts.some((k) => k.rows.some((r) => isBusyState(r.state) || needsUser(r.state) || r.state === 'starting'))

const rowText = (r: RailRow): string => `${rowLines(r, '').first} ${r.agent} ${r.task ?? ''}`.toLowerCase()

function checkoutHit(k: RailCheckout, q: string): RailCheckout | null {
  if (k.branch?.toLowerCase().includes(q)) return k
  const titles = new Map(k.groups.map((g) => [g.key, g.title.toLowerCase()]))
  const rows = k.rows.filter((r) => rowText(r).includes(q) || (!!r.group && !!titles.get(r.group)?.includes(q)))
  if (!rows.length) return null
  const kept = new Set(rows.map((r) => r.group))
  return { ...k, rows, groups: k.groups.filter((g) => kept.has(g.key)) }
}

/** The cluster whole when its name or folder matches, else only the checkouts / rows that match; null when nothing does. */
export function filterCluster(c: RailCluster, query: string, label: string): RailCluster | null {
  const q = query.trim().toLowerCase()
  if (!q) return c
  if (label.toLowerCase().includes(q) || c.root?.toLowerCase().includes(q)) return c
  const checkouts = c.checkouts.flatMap((k) => checkoutHit(k, q) ?? [])
  return checkouts.length ? { ...c, checkouts } : null
}

/** Sections are decided on the full cluster, so a filter never moves a project between them. Order inside each keeps the rail order. */
export function buildSections(clusters: readonly RailCluster[], query: string, label: (c: RailCluster) => string): RailSections {
  const out: RailSections = { agents: [], opened: [], others: [] }
  for (const c of clusters) {
    const hit = filterCluster(c, query, label(c))
    if (!hit) continue
    if (!c.live) out.others.push(hit)
    else if (hasAgentWork(c)) out.agents.push(hit)
    else out.opened.push(hit)
  }
  return out
}

/** A drop in the rendered list → indexes in the full rail order (what `useRail().move` takes). */
export function railMoveIndexes(shown: readonly string[], all: readonly string[], from: number, to: number): [number, number] | null {
  const a = shown[from] === undefined ? -1 : all.indexOf(shown[from]!)
  const b = shown[to] === undefined ? -1 : all.indexOf(shown[to]!)
  return a < 0 || b < 0 || a === b ? null : [a, b]
}
