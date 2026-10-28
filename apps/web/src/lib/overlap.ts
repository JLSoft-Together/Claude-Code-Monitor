export interface CheckoutChanges {
  root: string
  common: string | null
  branch: string | null
  files: readonly string[]
}

export interface OverlapHit {
  root: string
  branch: string | null
  files: string[]
}

const key = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()

export function intersect(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b)
  return a.filter((f) => set.has(f))
}

/** Per checkout root key: the other worktrees of the same repo that changed some of the same files. */
export function overlapHits(checkouts: readonly CheckoutChanges[]): Map<string, OverlapHit[]> {
  const out = new Map<string, OverlapHit[]>()
  const groups = new Map<string, CheckoutChanges[]>()
  for (const c of checkouts) {
    if (!c.common || !c.files.length) continue
    const g = groups.get(key(c.common)) ?? []
    if (!g.some((x) => key(x.root) === key(c.root))) g.push(c)
    groups.set(key(c.common), g)
  }
  for (const g of groups.values()) {
    for (const c of g) {
      const hits = g
        .filter((o) => o !== c)
        .map((o) => ({ root: o.root, branch: o.branch, files: intersect(c.files, o.files).sort() }))
        .filter((h) => h.files.length)
        .sort((x, y) => y.files.length - x.files.length)
      if (hits.length) out.set(key(c.root), hits)
    }
  }
  return out
}

export const rootKey = key
