import type { ReplaceTarget, SearchMatch, SearchQuery } from './preview'

export type SearchRow =
  | { kind: 'file'; path: string; count: number; collapsed: boolean; first: number }
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
    rows.push({ kind: 'file', path, count: j - i, collapsed: shut, first: i })
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

/** Mirrors desktop `preview/replaceFiles.ts`: regex mode expands `$1`..`$9` (existing groups) and `$&`, nothing else. */
export function expandReplacement(template: string, m: RegExpMatchArray, regex: boolean): string {
  if (!regex) return template
  return template.replace(/\$([1-9&])/g, (tok, k: string) => {
    if (k === '&') return m[0]
    const n = Number(k)
    return n < m.length ? (m[n] ?? '') : tok
  })
}

export type ReplaceRun = { text: string; kind: 'plain' | 'del' | 'ins' }

/** Before → after of one result line: each hit as a struck-out run followed by its replacement. */
export function replaceRuns(text: string, re: RegExp | null, template: string, regex: boolean): ReplaceRun[] {
  if (!re) return [{ text, kind: 'plain' }]
  const out: ReplaceRun[] = []
  let last = 0
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at), kind: 'plain' })
    out.push({ text: m[0], kind: 'del' })
    const next = expandReplacement(template, m, regex)
    if (next) out.push({ text: next, kind: 'ins' })
    last = at + m[0].length
    if (out.length > 60) break
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain' })
  return out.length ? out : [{ text, kind: 'plain' }]
}

export type Tick = 'all' | 'some' | 'none'

export function fileTick(first: number, count: number, skipped: ReadonlySet<number>): Tick {
  let off = 0
  for (let k = first; k < first + count; k++) if (skipped.has(k)) off++
  return off === 0 ? 'all' : off === count ? 'none' : 'some'
}

/** Ticked results grouped per file, the payload of `replaceFiles`. */
export function replacePlan(matches: readonly SearchMatch[], skipped: ReadonlySet<number>): { files: ReplaceTarget[]; lines: number } {
  const files: ReplaceTarget[] = []
  let lines = 0
  matches.forEach((m, i) => {
    if (skipped.has(i)) return
    const last = files[files.length - 1]
    const entry = { line: m.line, text: m.text }
    if (last?.path === m.path) last.lines.push(entry)
    else files.push({ path: m.path, lines: [entry] })
    lines++
  })
  return { files, lines }
}
