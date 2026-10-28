import { execGit } from './gitExec'

export interface SearchQuery {
  q: string
  regex: boolean
  caseSensitive: boolean
  word: boolean
}

export interface SearchMatch {
  /** Relative to the searched folder, forward slashes. */
  path: string
  line: number
  col: number
  text: string
}

export type SearchResult =
  | { ok: true; matches: SearchMatch[]; truncated: boolean }
  | { ok: false; error: 'denied' | 'not-repo' | 'no-git' | 'bad-query' | 'cancelled' | 'failed'; detail?: string }

export const SEARCH_MAX_MATCHES = 2000
const MAX_TEXT = 200
const MAX_BYTES = 4 * 1024 * 1024

export function cleanQuery(input: unknown): SearchQuery | null {
  const o = (input ?? {}) as Partial<Record<keyof SearchQuery, unknown>>
  if (typeof o.q !== 'string' || !o.q.length || o.q.length > 500 || /[\0\r\n]/.test(o.q)) return null
  return { q: o.q, regex: o.regex === true, caseSensitive: o.caseSensitive === true, word: o.word === true }
}

export function grepArgs(q: SearchQuery): string[] {
  return ['grep', '-n', '--column', '-I', '-z', '--untracked', '--no-color', q.regex ? '-E' : '-F', ...(q.caseSensitive ? [] : ['-i']), ...(q.word ? ['-w'] : []), '-e', q.q]
}

/** `path\0line\0col\0text\n` records from `git grep -z -n --column`. */
export function parseGrep(out: string, max = SEARCH_MAX_MATCHES): { matches: SearchMatch[]; truncated: boolean } {
  const matches: SearchMatch[] = []
  let truncated = false
  for (const rec of out.split('\n')) {
    if (!rec) continue
    const a = rec.indexOf('\0')
    const b = a < 0 ? -1 : rec.indexOf('\0', a + 1)
    const c = b < 0 ? -1 : rec.indexOf('\0', b + 1)
    if (c < 0) continue
    const line = Number(rec.slice(a + 1, b))
    const col = Number(rec.slice(b + 1, c))
    if (!Number.isInteger(line) || !Number.isInteger(col)) continue
    if (matches.length >= max) {
      truncated = true
      break
    }
    const raw = rec.slice(c + 1).replace(/\r$/, '')
    const start = Math.max(0, col - 1 - 60)
    const text = (start > 0 ? '…' : '') + raw.slice(start, start + MAX_TEXT)
    matches.push({ path: rec.slice(0, a).replace(/\\/g, '/'), line, col: col - start + (start > 0 ? 1 : 0), text })
  }
  return { matches, truncated }
}

export async function search(dir: string, q: SearchQuery, signal?: AbortSignal): Promise<SearchResult> {
  const res = await execGit(dir, grepArgs(q), { maxBytes: MAX_BYTES, timeoutMs: 15_000, signal })
  if (signal?.aborted) return { ok: false, error: 'cancelled' }
  if (res.code === 1 && !res.stderr.trim()) return { ok: true, matches: [], truncated: false }
  if (res.code !== 0) {
    if (/git not found/.test(res.stderr)) return { ok: false, error: 'no-git' }
    if (/not a git repository/i.test(res.stderr)) return { ok: false, error: 'not-repo' }
    if (res.code === 128 && /regex|regexp|unmatched|invalid/i.test(res.stderr)) return { ok: false, error: 'bad-query', detail: res.stderr.trim().slice(0, 200) }
    return { ok: false, error: 'failed', detail: res.stderr.trim().slice(0, 200) }
  }
  const parsed = parseGrep(res.stdout)
  return { ok: true, matches: parsed.matches, truncated: parsed.truncated || res.truncated }
}
