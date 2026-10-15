import type { LogQuery } from '@ccm/shared'

export type DatePreset = 'any' | '24h' | '7d' | '30d' | 'custom'
export const DATE_PRESETS: DatePreset[] = ['any', '24h', '7d', '30d', 'custom']

export interface LogFilters {
  text: string
  regex: boolean
  matchCase: boolean
  /** Full refname or null (all). */
  branch: string | null
  /** Compare with Current: commits in `branch` not in this ref. */
  notRef: string | null
  author: string | null
  date: DatePreset
  /** `YYYY-MM-DD`, local time, for `custom`. */
  from: string
  to: string
  /** Repo-relative. */
  paths: string[]
}

export const emptyFilters = (): LogFilters => ({ text: '', regex: false, matchCase: false, branch: null, notRef: null, author: null, date: 'any', from: '', to: '', paths: [] })

const DAY = 86400
const SPAN: Record<'24h' | '7d' | '30d', number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY }

/** Local midnight of a `YYYY-MM-DD` calendar date, in epoch seconds. Built from calendar fields so DST days (23h/25h) stay correct. */
function startOfDay(s: string, plusDays = 0): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + plusDays).getTime()
  return Number.isFinite(t) ? t / 1000 : null
}

export function toQuery(f: LogFilters, now: number, skip = 0): LogQuery {
  let since: number | null = null
  let until: number | null = null
  if (f.date === 'custom') {
    since = startOfDay(f.from)
    const next = startOfDay(f.to, 1)
    until = next === null ? null : next - 1
  } else if (f.date !== 'any') since = Math.floor(now / 1000) - SPAN[f.date]
  const text = f.text.trim()
  return { branch: f.branch, notRef: f.branch ? f.notRef : null, author: f.author, since, until, text: text || null, regex: f.regex, matchCase: f.matchCase, paths: [...f.paths], skip }
}

/** IntelliJ keeps the graph only while the history stays connected (no filter, or a branch). */
export const graphMode = (f: LogFilters): 'graph' | 'flat' => (f.author || f.notRef || f.text.trim() || f.paths.length || f.date !== 'any' ? 'flat' : 'graph')

export const hasFilters = (f: LogFilters): boolean => !!(f.branch || f.notRef || f.author || f.text.trim() || f.paths.length || f.date !== 'any')
