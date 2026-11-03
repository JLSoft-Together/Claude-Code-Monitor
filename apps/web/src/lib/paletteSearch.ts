import { pageVisible, type SettingsEntry, type SettingsEnv, type SettingsHit } from '../components/settings'
import { fuzzyFilter, parseQuickOpen, type FuzzyHit } from './fuzzy'

export type PaletteMode = 'actions' | 'sessions' | 'files' | 'settings'

const PREFIX: Record<string, PaletteMode> = { '>': 'actions', '@': 'sessions', '#': 'files', ':': 'settings' }

export const GROUP_CAP = 5
export const FILE_LIMIT = 50

/** A leading `>` `@` `#` `:` narrows the search to one kind; the rest of the text is the query. */
export function parsePrefix(query: string): { mode: PaletteMode | null; text: string } {
  const q = query.trimStart()
  const mode = PREFIX[q[0] ?? '']
  return mode ? { mode, text: q.slice(1).trim() } : { mode: null, text: query.trim() }
}

export const prefixOf = (mode: PaletteMode): string => Object.keys(PREFIX).find((k) => PREFIX[k] === mode)!

export const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')

export interface Searchable {
  label: string
  /** Lower-cased text the query is matched against, with accents (exact) and without (hay). */
  exact: string
  hay: string
}

export const searchable = (label: string, ...rest: (string | null | undefined)[]): Searchable => {
  const exact = [label, ...rest].filter(Boolean).join(' ').toLowerCase()
  return { label, exact, hay: fold(exact) }
}

const wordStart = (hay: string, w: string): boolean => {
  for (let i = hay.indexOf(w); i >= 0; i = hay.indexOf(w, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1]!)) return true
  return false
}

/**
 * Items containing every word of `text`, label matches first (word start, inside, then anywhere else).
 * An accented query matches exactly first ("âm" must not hit "làm"); accents are ignored for plain queries or when nothing matched.
 */
export function matchText<T extends Searchable>(items: readonly T[], text: string): T[] {
  const lower = text.toLowerCase()
  const raw = lower.split(/\s+/).filter(Boolean)
  if (!raw.length) return [...items]
  const run = (words: string[], field: 'exact' | 'hay', norm: (s: string) => string): T[] => {
    const scored: { item: T; score: number }[] = []
    for (const item of items) {
      if (!words.every((w) => item[field].includes(w))) continue
      const l = norm(item.label)
      scored.push({ item, score: Math.max(...words.map((w) => (wordStart(l, w) ? 0 : l.includes(w) ? 1 : 2))) })
    }
    return scored.sort((a, b) => a.score - b.score).map((s) => s.item)
  }
  if (fold(text) !== lower) {
    const exact = run(raw, 'exact', (s) => s.toLowerCase())
    if (exact.length) return exact
  }
  return run(fold(text).split(/\s+/).filter(Boolean), 'hay', fold)
}

export function cap<T>(items: readonly T[], expanded: boolean, limit = GROUP_CAP): { shown: T[]; hidden: number } {
  if (expanded || items.length <= limit) return { shown: [...items], hidden: 0 }
  return { shown: items.slice(0, limit), hidden: items.length - limit }
}

/** Every visible setting, for `:` with nothing typed yet. */
export function listSettings(all: readonly SettingsEntry[], env: SettingsEnv, t: (key: string) => string): SettingsHit[] {
  return all.filter((e) => (!e.needs || env[e.needs]) && pageVisible(e.page, env)).map((e) => ({ page: e.page, id: e.id, label: t(e.labelKey) }))
}

export function joinPath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`
}

export interface FileMatch {
  hits: FuzzyHit[]
  line?: number
}

/** Quick open's ranking (`file.ts:42` keeps the line); one letter is too vague to list in the mixed view. */
export function matchFiles(files: readonly string[], text: string, opts: { min?: number; limit?: number } = {}): FileMatch {
  const parsed = parseQuickOpen(text)
  if (parsed.query.length < (opts.min ?? 0)) return { hits: [] }
  return { hits: fuzzyFilter(files, parsed.query, { limit: opts.limit ?? FILE_LIMIT }), line: parsed.line }
}
