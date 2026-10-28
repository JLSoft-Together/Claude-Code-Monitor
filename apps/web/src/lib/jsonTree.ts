export type TreeFormat = 'json' | 'yaml'
export type TreeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
export type Segment = string | number

export interface TreeRow {
  /** Copyable path (`a.b[2].c`); root = ''. Also the row id. */
  path: string
  depth: number
  key: Segment | null
  kind: TreeKind | 'more'
  preview: string
  /** Children count for containers, hidden children for `more`. */
  size: number
  expanded: boolean
  hit: boolean
}

export interface FlattenOptions {
  expanded: ReadonlySet<string>
  filter?: string
  /** Children shown per container (path → count); default `CHILD_PAGE`. */
  shown?: ReadonlyMap<string, number>
  limit?: number
}

export const CHILD_PAGE = 200
export const ROW_LIMIT = 3000
const MATCH_VISIT_LIMIT = 200_000
const PREVIEW_MAX = 160

const IDENT = /^[A-Za-z_$][\w$]*$/

const childPath = (parent: string, key: Segment): string =>
  typeof key === 'number' ? `${parent}[${key}]` : IDENT.test(key) ? (parent ? `${parent}.${key}` : key) : `${parent}[${JSON.stringify(key)}]`

export const pathOf = (segments: readonly Segment[]): string => segments.reduce<string>(childPath, '')

export function kindOf(v: unknown): TreeKind {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  if (t === 'object') return 'object'
  if (t === 'number' || t === 'bigint') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

function entriesOf(v: unknown): [Segment, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [i, x])
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>)
  return []
}

function sizeOf(v: unknown): number {
  if (Array.isArray(v)) return v.length
  if (v && typeof v === 'object') return Object.keys(v).length
  return 0
}

export function previewOf(v: unknown): string {
  const k = kindOf(v)
  if (k === 'object') return `{${sizeOf(v)}}`
  if (k === 'array') return `[${sizeOf(v)}]`
  if (k === 'null') return 'null'
  if (k === 'string') {
    const s = v instanceof Date ? v.toISOString() : String(v)
    const q = JSON.stringify(s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) : s)
    return s.length > PREVIEW_MAX ? `${q.slice(0, -1)}…"` : q
  }
  return String(v)
}

/** Paths of containers holding a key that matches `filter` (ancestors stay open while filtering). */
function matchPaths(root: unknown, filter: string): { hits: Set<string>; open: Set<string> } {
  const hits = new Set<string>()
  const open = new Set<string>()
  let visits = 0
  const walk = (v: unknown, path: string, ancestors: string[]): void => {
    for (const [key, child] of entriesOf(v)) {
      if (++visits > MATCH_VISIT_LIMIT) return
      const p = childPath(path, key)
      if (typeof key === 'string' && key.toLowerCase().includes(filter)) {
        hits.add(p)
        for (const a of ancestors) open.add(a)
        open.add(path)
      }
      if (sizeOf(child)) walk(child, p, [...ancestors, path])
    }
  }
  walk(root, '', [])
  return { hits, open }
}

export function flattenTree(root: unknown, opts: FlattenOptions): { rows: TreeRow[]; truncated: boolean } {
  const limit = opts.limit ?? ROW_LIMIT
  const filter = opts.filter?.trim().toLowerCase() ?? ''
  const match = filter ? matchPaths(root, filter) : null
  const rows: TreeRow[] = []
  let truncated = false

  const isOpen = (path: string): boolean => (match ? match.open.has(path) || opts.expanded.has(path) : opts.expanded.has(path))

  const visit = (v: unknown, path: string, key: Segment | null, depth: number): void => {
    if (rows.length >= limit) {
      truncated = true
      return
    }
    const kind = kindOf(v)
    const size = sizeOf(v)
    const expanded = size > 0 && isOpen(path)
    rows.push({ path, depth, key, kind, preview: previewOf(v), size, expanded, hit: !!match?.hits.has(path) })
    if (!expanded) return
    const all = entriesOf(v)
    // Filtering inside an ancestor that is open only because of a hit: keep just the branches leading to hits.
    const onlyHits = match && !opts.expanded.has(path) && !match.hits.has(path)
    const kids = onlyHits ? all.filter(([k]) => { const p = childPath(path, k); return match.hits.has(p) || match.open.has(p) }) : all
    const cap = opts.shown?.get(path) ?? CHILD_PAGE
    for (const [k, child] of kids.slice(0, cap)) {
      visit(child, childPath(path, k), k, depth + 1)
      if (truncated) return
    }
    if (kids.length > cap) rows.push({ path: `${path}#more`, depth: depth + 1, key: null, kind: 'more', preview: '', size: kids.length - cap, expanded: false, hit: false })
  }
  visit(root, '', null, 0)
  return { rows, truncated }
}

/** Containers up to `depth` levels (for "expand"), capped at `max` paths. */
export function pathsToDepth(root: unknown, depth: number, max = 2000): Set<string> {
  const out = new Set<string>()
  const walk = (v: unknown, path: string, d: number): void => {
    if (d > depth || out.size >= max || !sizeOf(v)) return
    out.add(path)
    for (const [k, child] of entriesOf(v)) walk(child, childPath(path, k), d + 1)
  }
  walk(root, '', 0)
  return out
}

export function treeFormat(path: string): TreeFormat | null {
  const p = path.toLowerCase()
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.yaml') || p.endsWith('.yml')) return 'yaml'
  return null
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string }

export async function parseTree(text: string, format: TreeFormat): Promise<ParseResult> {
  try {
    if (format === 'json') return { ok: true, value: JSON.parse(text.replace(/^﻿/, '')) }
    const { parseAllDocuments } = await import('yaml')
    const docs = parseAllDocuments(text)
    const list = Array.isArray(docs) ? docs : [docs]
    for (const d of list) if (d.errors.length) return { ok: false, error: d.errors[0]!.message }
    const values = list.map((d) => d.toJS({ maxAliasCount: 100 }) as unknown)
    return { ok: true, value: values.length <= 1 ? (values[0] ?? null) : values }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
