import { promises as fs } from 'node:fs'
import path from 'node:path'
import { decodeUtf8 } from './files'
import { MAX_WRITE_BYTES, writeTextFile, type FileWriteError } from './fileWrite'
import { realOrNull, rootOf } from './paths'
import { cleanQuery, SEARCH_MAX_MATCHES, type SearchQuery } from './search'

export const REPLACE_MAX_FILES = 500
const MAX_REPLACEMENT = 1000
const SNIFF_BYTES = 8 * 1024

/** One line the search listed: 1-based line + the (possibly cut) text git grep showed for it. */
export interface ReplaceLine {
  line: number
  text: string
}
export interface ReplaceTarget {
  /** Relative to the searched folder, forward slashes. */
  path: string
  lines: ReplaceLine[]
}
export interface ReplaceRequest {
  query: SearchQuery
  replacement: string
  files: ReplaceTarget[]
}
export type ReplaceSkip = 'changed' | 'no-match' | 'missing' | 'denied' | 'too-large' | 'encoding' | 'conflict' | 'busy' | 'failed'
export type ReplaceFileResult = { path: string; ok: true; count: number } | { path: string; ok: false; error: ReplaceSkip }
export type ReplaceResult =
  | { ok: true; results: ReplaceFileResult[]; files: number; count: number }
  | { ok: false; error: 'denied' | 'bad-query' | 'unsupported' | 'too-many' | 'cancelled' }

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Same JS regex the page highlights with (`lib/searchView.ts` `highlighter`); null when it does not compile here. */
export function matcher(q: SearchQuery): RegExp | null {
  const body = q.regex ? q.q : escape(q.q)
  try {
    return new RegExp(q.word ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body, `gu${q.caseSensitive ? '' : 'i'}`)
  } catch {
    return null
  }
}

/** Regex mode: `$1`..`$9` (a group the pattern has) and `$&`; every other `$` sequence, `$$` included, stays literal. */
export function expandReplacement(template: string, m: RegExpMatchArray, regex: boolean): string {
  if (!regex) return template
  return template.replace(/\$([1-9&])/g, (tok, k: string) => {
    if (k === '&') return m[0]
    const n = Number(k)
    return n < m.length ? (m[n] ?? '') : tok
  })
}

/** Every non-empty match of `re` in one line replaced; empty matches (`^`, lookarounds) are left alone. */
export function replaceInLine(line: string, re: RegExp, template: string, regex: boolean): { text: string; count: number } {
  let out = ''
  let last = 0
  let count = 0
  re.lastIndex = 0
  for (const m of line.matchAll(re)) {
    if (!m[0]) continue
    const at = m.index ?? 0
    out += line.slice(last, at) + expandReplacement(template, m, regex)
    last = at + m[0].length
    count++
  }
  return { text: count ? out + line.slice(last) : line, count }
}

const snippetOf = (shown: string): string => shown.replace(/^…/, '').replace(/^﻿/, '')

/**
 * New text for one file, or why it is skipped: a listed line that no longer holds the text the search showed means
 * the file changed since (nothing in it is replaced). Lines split on LF like git grep counts them.
 */
export function planFile(text: string, lines: readonly ReplaceLine[], re: RegExp, template: string, regex: boolean): { text: string; count: number } | { error: 'changed' | 'no-match' } {
  const rows = text.split('\n')
  let count = 0
  for (const { line, text: shown } of lines) {
    const raw = rows[line - 1]
    if (raw === undefined) return { error: 'changed' }
    const cr = raw.endsWith('\r')
    const body = cr ? raw.slice(0, -1) : raw
    if (!body.includes(snippetOf(shown))) return { error: 'changed' }
    const res = replaceInLine(body, re, template, regex)
    if (!res.count) return { error: 'no-match' }
    rows[line - 1] = cr ? `${res.text}\r` : res.text
    count += res.count
  }
  return { text: rows.join('\n'), count }
}

const isRel = (p: unknown): p is string =>
  typeof p === 'string' && p.length > 0 && p.length <= 1024 && !/[\0\r\n]/.test(p) && !path.isAbsolute(p) && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes('..')

export function cleanReplace(input: unknown): ReplaceRequest | 'bad-query' | 'too-many' | null {
  const o = (input ?? {}) as Record<string, unknown>
  const query = cleanQuery(o.query)
  if (!query) return 'bad-query'
  const replacement = o.replacement
  if (typeof replacement !== 'string' || replacement.length > MAX_REPLACEMENT || /[\0\r\n]/.test(replacement)) return null
  if (!Array.isArray(o.files) || !o.files.length) return null
  if (o.files.length > REPLACE_MAX_FILES) return 'too-many'
  const files: ReplaceTarget[] = []
  const seen = new Set<string>()
  let total = 0
  for (const f of o.files as unknown[]) {
    const { path: rel, lines } = (f ?? {}) as { path?: unknown; lines?: unknown }
    if (!isRel(rel) || seen.has(rel) || !Array.isArray(lines) || !lines.length) return null
    seen.add(rel)
    const clean: ReplaceLine[] = []
    for (const l of lines as unknown[]) {
      const { line, text } = (l ?? {}) as { line?: unknown; text?: unknown }
      if (!Number.isInteger(line) || (line as number) < 1 || typeof text !== 'string' || text.length > 400) return null
      clean.push({ line: line as number, text })
    }
    total += clean.length
    if (total > SEARCH_MAX_MATCHES) return 'too-many'
    files.push({ path: rel, lines: clean.sort((a, b) => a.line - b.line).filter((l, i, a) => i === 0 || a[i - 1]!.line !== l.line) })
  }
  return { query, replacement, files }
}

export interface ReplaceDeps {
  /** Local History snapshot of the disk text, awaited before the file is written. */
  snapshot?: (real: string, previous: string) => Promise<void>
}

const writeError = (e: FileWriteError): ReplaceSkip => (e === 'missing' || e === 'denied' || e === 'too-large' || e === 'encoding' || e === 'conflict' || e === 'busy' ? e : 'failed')

/**
 * Replace in the files the search listed under `root` (a real, allowed folder), one by one. Each file is read again,
 * checked against what the search showed, snapshotted, then written atomically only if its mtime did not move since.
 */
export async function applyReplace(root: string, req: ReplaceRequest, roots: readonly string[], deps: ReplaceDeps = {}): Promise<ReplaceResult> {
  const re = matcher(req.query)
  if (!re) return { ok: false, error: 'unsupported' }
  const results: ReplaceFileResult[] = []
  let files = 0
  let count = 0
  for (const target of req.files) {
    const res = await replaceOne(root, target, re, req, roots, deps)
    results.push(res)
    if (res.ok) {
      files++
      count += res.count
    }
  }
  return { ok: true, results, files, count }
}

async function replaceOne(root: string, target: ReplaceTarget, re: RegExp, req: ReplaceRequest, roots: readonly string[], deps: ReplaceDeps): Promise<ReplaceFileResult> {
  const fail = (error: ReplaceSkip): ReplaceFileResult => ({ path: target.path, ok: false, error })
  const real = await realOrNull(path.join(root, target.path))
  if (!real) return fail('missing')
  if (!rootOf(real, [root]) || !rootOf(real, roots)) return fail('denied')
  const stat = await fs.stat(real).catch(() => null)
  if (!stat?.isFile()) return fail('missing')
  if (stat.size > MAX_WRITE_BYTES) return fail('too-large')
  const bytes = await fs.readFile(real).catch(() => null)
  if (!bytes) return fail('missing')
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return fail('encoding')
  const text = decodeUtf8(bytes)
  if (text === null) return fail('encoding')
  const plan = planFile(text, target.lines, re, req.replacement, req.query.regex)
  if ('error' in plan) return fail(plan.error)
  if (plan.text === text) return { path: target.path, ok: true, count: 0 }
  await deps.snapshot?.(real, text).catch(() => undefined)
  const written = await writeTextFile({ path: real, text: plan.text, expectedMtime: stat.mtimeMs }, roots)
  return written.ok ? { path: target.path, ok: true, count: plan.count } : fail(writeError(written.error))
}
