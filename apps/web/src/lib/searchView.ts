import type { SearchMatch, SearchQuery } from './preview'

export type SearchRow =
  | { kind: 'file'; path: string; count: number; collapsed: boolean }
  | { kind: 'match'; path: string; line: number; text: string; index: number }

/** File header + its matches, in git grep order; collapsed files keep only the header. */
export function searchRows(matches: readonly SearchMatch[], collapsed: ReadonlySet<string>): SearchRow[] {
  const rows: SearchRow[] = []
  let i = 0
  while (i < matches.length) {
    const path = matches[i]!.path
    let j = i
    while (j < matches.length && matches[j]!.path === path) j++
    const shut = collapsed.has(path)
    rows.push({ kind: 'file', path, count: j - i, collapsed: shut })
    if (!shut) for (let k = i; k < j; k++) rows.push({ kind: 'match', path, line: matches[k]!.line, text: matches[k]!.text, index: k })
    i = j
  }
  return rows
}

export const fileCount = (matches: readonly SearchMatch[]): number => {
  let n = 0
  for (let i = 0; i < matches.length; i++) if (i === 0 || matches[i]!.path !== matches[i - 1]!.path) n++
  return n
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** JS regex mirroring the git grep query, for highlighting only; null when it does not compile here. */
export function highlighter(q: SearchQuery): RegExp | null {
  const body = q.regex ? q.q : escape(q.q)
  try {
    return new RegExp(q.word ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body, `gu${q.caseSensitive ? '' : 'i'}`)
  } catch {
    return null
  }
}

export function hitRuns(text: string, re: RegExp | null): { text: string; hit: boolean }[] {
  if (!re) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  let last = 0
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at), hit: false })
    out.push({ text: m[0], hit: true })
    last = at + m[0].length
    if (out.length > 40) break
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out.length ? out : [{ text, hit: false }]
}
