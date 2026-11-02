import { dirKey } from '../stores/favorites'
import { fuzzyScore } from './fuzzy'
import type { RailCluster } from './rail/railModel'

export interface ProjectEntry {
  key: string
  dir: string
  name: string
  /** Branch of the active checkout (else the main one); null for closed projects or plain folders. */
  branch: string | null
  /** Open tabs in the workspace; 0 = closed (remembered or favourite). */
  tabs: number
  tabKeys: string[]
  needs: number
  failed: number
  live: boolean
  active: boolean
  favorite: boolean
  usedAt: number
}

export interface ProjectHit {
  entry: ProjectEntry
  name: number[]
  dir: number[]
}

export interface MruEntry {
  dir: string
  at: number
}

export const MRU_KEY = 'ccm.workspace.projectMru'
export const MRU_LIMIT = 60

const folderName = (dir: string): string => dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir

export function readMru(raw: string | null): MruEntry[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is MruEntry => !!x && typeof x.dir === 'string' && typeof x.at === 'number') : []
  } catch {
    return []
  }
}

export function touchMru(list: readonly MruEntry[], dir: string, at: number): MruEntry[] {
  const key = dirKey(dir)
  return [{ dir, at }, ...list.filter((x) => dirKey(x.dir) !== key)].slice(0, MRU_LIMIT)
}

export function dropMru(list: readonly MruEntry[], dir: string): MruEntry[] {
  const key = dirKey(dir)
  return list.filter((x) => dirKey(x.dir) !== key)
}

/**
 * Every project the owner can jump to: rail clusters (open or remembered), the switcher's own longer history
 * (the rail keeps only a few closed folders) and favourites. Most recently used first, the rest in rail order.
 */
export function projectEntries(input: { clusters: readonly RailCluster[]; mru: readonly MruEntry[]; favorites: readonly { dir: string; label?: string }[] }): ProjectEntry[] {
  const byKey = new Map<string, ProjectEntry>()
  const order: string[] = []
  const add = (dir: string, name: string): ProjectEntry => {
    const key = dirKey(dir)
    let e = byKey.get(key)
    if (!e) {
      e = { key, dir, name, branch: null, tabs: 0, tabKeys: [], needs: 0, failed: 0, live: false, active: false, favorite: false, usedAt: 0 }
      byKey.set(key, e)
      order.push(key)
    }
    return e
  }
  for (const c of input.clusters) {
    if (!c.root) continue
    const e = add(c.root, c.name || folderName(c.root))
    e.tabs = c.tabKeys.length
    e.branch = (c.checkouts.find((k) => k.active) ?? c.checkouts[0])?.branch ?? null
    e.tabKeys = [...c.tabKeys]
    e.needs = c.needs
    e.failed = c.failed
    e.live = c.live
    e.active = c.active
    // A remembered sub-folder of this repo is the same project.
    for (const h of c.history) if (!byKey.has(dirKey(h))) byKey.set(dirKey(h), e)
  }
  for (const m of input.mru) {
    const e = byKey.get(dirKey(m.dir)) ?? add(m.dir, folderName(m.dir))
    e.usedAt = Math.max(e.usedAt, m.at)
  }
  for (const f of input.favorites) {
    const e = byKey.get(dirKey(f.dir)) ?? add(f.dir, f.label || folderName(f.dir))
    e.favorite = true
  }
  const rank = new Map(order.map((k, i) => [k, i]))
  return order.map((k) => byKey.get(k)!).sort((a, b) => b.usedAt - a.usedAt || rank.get(a.key)! - rank.get(b.key)!)
}

/** Empty query keeps the given order; otherwise name matches outrank path-only matches. */
export function filterProjects(entries: readonly ProjectEntry[], query: string): ProjectHit[] {
  const q = query.trim()
  if (!q) return entries.map((entry) => ({ entry, name: [], dir: [] }))
  const out: { hit: ProjectHit; score: number }[] = []
  for (const entry of entries) {
    const byName = fuzzyScore(q, entry.name)
    const byDir = fuzzyScore(q, entry.dir)
    if (byName && (!byDir || byName.score + 20 >= byDir.score)) out.push({ hit: { entry, name: byName.positions, dir: [] }, score: byName.score + 20 + (entry.tabs ? 2 : 0) })
    else if (byDir) out.push({ hit: { entry, name: [], dir: byDir.positions }, score: byDir.score + (entry.tabs ? 2 : 0) })
  }
  return out.sort((a, b) => b.score - a.score || b.hit.entry.usedAt - a.hit.entry.usedAt).map((x) => x.hit)
}

/** The tab to land on: the one focused last, else the first. */
export function landingTab(tabKeys: readonly string[], focusedAt: (tabKey: string) => number): string | undefined {
  let best: string | undefined
  let top = -1
  for (const k of tabKeys) {
    const at = focusedAt(k)
    if (at > top) ((top = at), (best = k))
  }
  return best
}
