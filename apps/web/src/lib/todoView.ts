import type { SearchMatch, SearchQuery } from './preview'

export const TODO_TAGS = ['TODO', 'FIXME', 'HACK', 'XXX'] as const
export type TodoTag = (typeof TODO_TAGS)[number]

/** `git grep -w -E` = `\b(TODO|FIXME|HACK|XXX)\b` without relying on `\b` in the host's regex flavour. */
export const TODO_QUERY: SearchQuery = { q: TODO_TAGS.join('|'), regex: true, caseSensitive: true, word: true }

export const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/g

export interface TodoMatch extends SearchMatch {
  tag: TodoTag
}

export function tagOf(m: SearchMatch): TodoTag | null {
  const at = m.text.slice(Math.max(0, m.col - 1))
  for (const t of TODO_TAGS) if (at.startsWith(t) && !/\w/.test(at[t.length] ?? '')) return t
  TODO_RE.lastIndex = 0
  const hit = TODO_RE.exec(m.text)
  return (hit?.[1] as TodoTag | undefined) ?? null
}

/** Hits git grep found but whose tag is not readable (cut text) are dropped. */
export function todoMatches(matches: readonly SearchMatch[]): TodoMatch[] {
  const out: TodoMatch[] = []
  for (const m of matches) {
    const tag = tagOf(m)
    if (tag) out.push({ ...m, tag })
  }
  return out
}

export function tagCounts(items: readonly TodoMatch[]): Record<TodoTag, number> {
  const out = { TODO: 0, FIXME: 0, HACK: 0, XXX: 0 }
  for (const m of items) out[m.tag]++
  return out
}

export const onlyTag = (items: readonly TodoMatch[], tag: TodoTag | null): TodoMatch[] => (tag ? items.filter((m) => m.tag === tag) : [...items])
