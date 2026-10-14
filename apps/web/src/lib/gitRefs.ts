import type { RefsResult } from '@ccm/shared'

export interface RefLabel {
  kind: 'head' | 'local' | 'remote' | 'tag'
  name: string
  current?: boolean
  /** Set on a local label whose `<remote>/<name>` points at the same commit (shown as "origin & main"). */
  remote?: string
}

export type RefsOk = Extract<RefsResult, { ok: true }>

export function parseDecorations(d: string, remotes: readonly string[]): RefLabel[] {
  const parts = d.split(', ').map((s) => s.trim()).filter(Boolean)
  const labels: RefLabel[] = []
  const remoteNames = new Set<string>()
  for (const p of parts) {
    if (p === 'HEAD') labels.push({ kind: 'head', name: 'HEAD', current: true })
    else if (p.startsWith('HEAD -> ')) labels.push({ kind: 'local', name: p.slice(8), current: true })
    else if (p.startsWith('tag: ')) labels.push({ kind: 'tag', name: p.slice(5) })
    else if (remotes.some((r) => p.startsWith(`${r}/`))) {
      if (!p.endsWith('/HEAD')) remoteNames.add(p)
    } else labels.push({ kind: 'local', name: p })
  }
  for (const l of labels) {
    if (l.kind !== 'local') continue
    const r = remotes.find((rem) => remoteNames.has(`${rem}/${l.name}`))
    if (r) {
      l.remote = r
      remoteNames.delete(`${r}/${l.name}`)
    }
  }
  const tagsAt = labels.findIndex((l) => l.kind === 'tag')
  const remoteLabels: RefLabel[] = [...remoteNames].map((name) => ({ kind: 'remote', name }))
  if (tagsAt < 0) return [...labels, ...remoteLabels]
  return [...labels.slice(0, tagsAt), ...remoteLabels, ...labels.slice(tagsAt)]
}

export const labelText = (l: RefLabel): string => (l.remote ? `${l.remote} & ${l.name}` : l.name)

export type RefRow =
  | { kind: 'section'; id: string; section: 'head' | 'local' | 'remote' | 'tags'; depth: 0; expanded: boolean }
  | { kind: 'folder'; id: string; name: string; depth: number; expanded: boolean }
  | {
      kind: 'ref'
      id: string
      ref: string
      name: string
      leaf: string
      depth: number
      refKind: 'head' | 'local' | 'remote' | 'tag'
      current: boolean
      tracked: boolean
      ahead: number
      behind: number
      gone: boolean
    }

interface Leaf {
  ref: string
  name: string
  refKind: 'local' | 'remote' | 'tag'
  current: boolean
  tracked: boolean
  ahead: number
  behind: number
  gone: boolean
}

/** Rows of `leaves` nested by `/` under `prefix`; `strip` = leading name part already shown by a parent row. */
function nest(rows: RefRow[], leaves: Leaf[], idBase: string, depth: number, strip: string, collapsed: ReadonlySet<string>, open: boolean): void {
  const folders = new Map<string, Leaf[]>()
  const direct: Leaf[] = []
  for (const l of leaves) {
    const rest = l.name.slice(strip.length)
    const slash = rest.indexOf('/')
    if (slash < 0) direct.push(l)
    else {
      const f = rest.slice(0, slash)
      folders.set(f, [...(folders.get(f) ?? []), l])
    }
  }
  for (const l of direct) {
    const leaf = l.name.slice(strip.length)
    rows.push({ kind: 'ref', id: `r:${l.ref}`, ref: l.ref, name: l.name, leaf, depth, refKind: l.refKind, current: l.current, tracked: l.tracked, ahead: l.ahead, behind: l.behind, gone: l.gone })
  }
  for (const [f, list] of folders) {
    const id = `${idBase}/${f}`
    const expanded = open || !collapsed.has(id)
    rows.push({ kind: 'folder', id, name: f, depth, expanded })
    if (expanded) nest(rows, list, id, depth + 1, `${strip}${f}/`, collapsed, open)
  }
}

export function refTree(refs: RefsOk, filter: string, collapsed: ReadonlySet<string>): RefRow[] {
  const q = filter.trim().toLowerCase()
  const match = (name: string): boolean => !q || name.toLowerCase().includes(q)
  const filtering = !!q
  const rows: RefRow[] = [{ kind: 'section', id: 'head', section: 'head', depth: 0, expanded: true }]
  const local: Leaf[] = refs.local
    .filter((l) => match(l.name))
    .map((l) => ({ ref: l.ref, name: l.name, refKind: 'local', current: l.name === refs.head.branch, tracked: !!l.upstream, ahead: l.ahead, behind: l.behind, gone: l.gone }))
  const section = (id: 'local' | 'remote' | 'tags', leaves: Leaf[] | null, fill: () => void): void => {
    if (filtering && leaves !== null && !leaves.length) return
    const expanded = filtering || !collapsed.has(id)
    rows.push({ kind: 'section', id, section: id, depth: 0, expanded })
    if (expanded) fill()
  }
  section('local', local, () => nest(rows, local, 'local', 1, '', collapsed, filtering))
  const remoteLeaves = refs.remotes.map((g) => ({
    name: g.name,
    leaves: g.refs.filter((r) => match(r.name)).map<Leaf>((r) => ({ ref: r.ref, name: r.name, refKind: 'remote', current: false, tracked: false, ahead: 0, behind: 0, gone: false })),
  }))
  section('remote', remoteLeaves.flatMap((g) => g.leaves), () => {
    for (const g of remoteLeaves) {
      if (filtering && !g.leaves.length) continue
      const id = `remote/${g.name}`
      const expanded = filtering || !collapsed.has(id)
      rows.push({ kind: 'folder', id, name: g.name, depth: 1, expanded })
      if (expanded) nest(rows, g.leaves, id, 2, `${g.name}/`, collapsed, filtering)
    }
  })
  const tags: Leaf[] = refs.tags.filter((t) => match(t.name)).map((t) => ({ ref: t.ref, name: t.name, refKind: 'tag', current: false, tracked: false, ahead: 0, behind: 0, gone: false }))
  section('tags', tags, () => nest(rows, tags, 'tags', 1, '', collapsed, filtering))
  return rows
}
