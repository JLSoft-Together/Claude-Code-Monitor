import { CATALOG, type CatalogEntry, type ExtScope, type ExtStatus, type McpServerRow, type McpState } from '@ccm/shared'

/** What a catalog card shows. `scopes` = where it is configured (for plugins: where any of its plugins is). */
export interface EntryState {
  state: McpState | 'notInstalled' | 'installed' | 'guide'
  scopes: ExtScope[]
  /** Server name to sign in / remove (as configured). */
  server?: string
  /** Provided by an installed plugin (`plugin:<p>:<s>`), not configured by us. */
  viaPlugin?: string
  /** Plugin entries: installed plugin ids (`name@marketplace`). */
  installed?: string[]
  total?: number
}

export const namesOf = (entry: CatalogEntry): string[] => [...(entry.server ? [entry.server] : []), ...(entry.match ?? [])]

const lower = (s: string): string => s.toLowerCase()

export function pluginIds(entry: CatalogEntry): string[] {
  return entry.install.type === 'plugins' ? entry.install.plugins.map((p) => `${p}@${(entry.install as { marketplace: string }).marketplace}`) : []
}

export function entryState(entry: CatalogEntry, status: ExtStatus | null, mcp: McpServerRow[] | null): EntryState {
  if (entry.kind === 'plugin') {
    const ids = pluginIds(entry)
    const rows = (status?.plugins ?? []).filter((p) => ids.includes(p.id))
    const scopes = [...new Set(rows.map((r) => r.scope))]
    return { state: rows.length ? 'installed' : 'notInstalled', scopes, installed: [...new Set(rows.map((r) => r.id))], total: ids.length }
  }
  const names = namesOf(entry).map(lower)
  const configured = (status?.configured ?? []).filter((c) => names.includes(lower(c.name)))
  const own = configured[0]
  const live = (mcp ?? []).filter((r) => names.includes(lower(r.name)))
  // A server we configured wins over the same service offered by a plugin.
  const row = (own && live.find((r) => lower(r.name) === lower(own.name))) ?? live.find((r) => !r.plugin) ?? live[0]
  const scopes = [...new Set(configured.flatMap((c) => c.scopes))]
  if (!own && !row) return { state: entry.install.type === 'guide' ? 'guide' : 'notInstalled', scopes }
  return {
    state: row?.state ?? 'unknown',
    scopes,
    server: own?.name ?? row?.name,
    ...(!own && row?.plugin ? { viaPlugin: row.plugin } : {}),
  }
}

/** Servers, plugins found that no catalog entry claims. */
export function others(status: ExtStatus | null, mcp: McpServerRow[] | null): { servers: McpServerRow[]; plugins: { id: string; scope: ExtScope; enabled: boolean }[] } {
  const claimed = new Set(CATALOG.filter((e) => e.kind === 'mcp').flatMap(namesOf).map(lower))
  const claimedPlugins = new Set(CATALOG.flatMap(pluginIds))
  const byName = new Map<string, McpServerRow>()
  for (const c of status?.configured ?? []) if (!claimed.has(lower(c.name))) byName.set(c.name, { name: c.name, state: 'unknown', scopes: c.scopes })
  for (const r of mcp ?? []) if (!claimed.has(lower(r.name))) byName.set(r.name, { ...r, scopes: r.scopes.length ? r.scopes : (byName.get(r.name)?.scopes ?? []) })
  return {
    servers: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    plugins: (status?.plugins ?? []).filter((p) => !claimedPlugins.has(p.id)).sort((a, b) => a.id.localeCompare(b.id)),
  }
}

/** Default scope for an install: global view → user; project view → local when a secret is involved, else shared. */
export function defaultScope(entry: CatalogEntry, project: boolean): ExtScope {
  if (!project) return 'user'
  return entry.fields.some((f) => f.secret) ? 'local' : 'project'
}

/** Scope the Remove button acts on: the one matching the current view. */
export function removeScope(scopes: readonly ExtScope[], project: boolean): ExtScope | null {
  if (!project) return scopes.includes('user') ? 'user' : null
  return scopes.includes('local') ? 'local' : scopes.includes('project') ? 'project' : null
}
