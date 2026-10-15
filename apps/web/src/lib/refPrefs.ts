import { pathKey } from './changesView'
import type { RefsOk } from './gitRefs'

export const FAVORITES_KEY = 'ccm.workspace.logFavorites'
export const REFS_VIEW_KEY = 'ccm.workspace.logRefsView'
const MAX_FAVORITES = 200

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // preference only
  }
}

/** Favorite refs of a repo; never set yet → `main` / `master` when they exist (IntelliJ default). */
export function readFavorites(repo: string, refs: Pick<RefsOk, 'local'>): Set<string> {
  const all = readJson<Record<string, unknown>>(FAVORITES_KEY)
  const mine = all && typeof all === 'object' ? all[pathKey(repo)] : undefined
  if (Array.isArray(mine)) return new Set(mine.filter((r): r is string => typeof r === 'string'))
  return new Set(refs.local.map((l) => l.ref).filter((r) => r === 'refs/heads/main' || r === 'refs/heads/master'))
}

export function writeFavorites(repo: string, favs: ReadonlySet<string>): void {
  const stored = readJson<Record<string, string[]>>(FAVORITES_KEY)
  const all = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  all[pathKey(repo)] = [...favs].slice(0, MAX_FAVORITES)
  writeJson(FAVORITES_KEY, all)
}

export function readRefsView(): { group: boolean; tags: boolean } {
  const v = readJson<{ group?: unknown; tags?: unknown }>(REFS_VIEW_KEY)
  return { group: v?.group !== false, tags: v?.tags !== false }
}

export function writeRefsView(v: { group: boolean; tags: boolean }): void {
  writeJson(REFS_VIEW_KEY, { group: v.group, tags: v.tags })
}
