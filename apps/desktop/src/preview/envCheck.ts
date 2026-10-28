import { promises as fs } from 'node:fs'
import path from 'node:path'
import { realOrNull, rootKey } from './paths'

export const ENV_TEMPLATES = ['.env.example', '.env.sample', '.env.template'] as const
export const ENV_MAX_BYTES = 1024 * 1024
export const ENV_MAX_FILES = 40

const ENV_NAME = /^\.env(\.[^/\\]+)?$/
const TEMPLATE_NAME = /\.(example|sample|template)$/i
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s?(.*)$/

export const isEnvFileName = (name: string): boolean => name.length <= 255 && ENV_NAME.test(name) && !name.includes('..')
export const isEnvTemplate = (name: string): boolean => isEnvFileName(name) && TEMPLATE_NAME.test(name)

export interface EnvEntry {
  value: string
  /** 1-based line of the last assignment (dotenv: the last one wins). */
  line: number
}

/** Reads one quoted value from `rest` (starting after the opening quote), continuing on later lines when it is not closed. */
function readQuoted(lines: string[], start: number, rest: string, quote: string): { value: string; end: number } | null {
  let out = ''
  let text = rest
  for (let i = start; i < lines.length; i++) {
    for (let j = 0; j < text.length; j++) {
      const c = text[j]!
      if (c === quote) return { value: out, end: i }
      if (c === '\\' && quote === '"' && j + 1 < text.length) {
        const n = text[++j]!
        out += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n === '"' || n === '\\' ? n : `\\${n}`
      } else out += c
    }
    out += '\n'
    text = lines[i + 1] ?? ''
  }
  return null
}

/** KEY=VALUE pairs of a .env file: `export`, single / double / backtick quotes (multi-line), `#` comments. */
export function parseEnv(text: string): Map<string, EnvEntry> {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  const out = new Map<string, EnvEntry>()
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]!)
    if (!m) continue
    const key = m[1]!
    const rest = m[2]!.trimStart()
    const quote = rest[0]
    let value: string
    const line = i + 1
    const quoted = quote === '"' || quote === "'" || quote === '`' ? readQuoted(lines, i, rest.slice(1), quote) : null
    if (quoted) {
      value = quoted.value
      i = quoted.end
    } else {
      value = rest.startsWith('#') ? '' : rest.replace(/\s+#.*$/, '').trim()
    }
    out.set(key, { value, line })
  }
  return out
}

export type EnvStatus = 'ok' | 'empty' | 'missing' | 'extra'
export interface EnvRow {
  key: string
  status: EnvStatus
  /** The file's value is empty or blank; false for a missing key. */
  empty: boolean
  line: number | null
}
export type EnvCounts = Record<EnvStatus, number>

const isEmpty = (e: EnvEntry | undefined): boolean => !!e && e.value.trim() === ''

/** Template keys first (missing / empty / ok), then the file's extra keys. Without a template every key is ok or empty. */
export function compareEnv(template: Map<string, EnvEntry> | null, file: Map<string, EnvEntry>): EnvRow[] {
  const rows: EnvRow[] = []
  if (template) {
    for (const key of template.keys()) {
      const e = file.get(key)
      rows.push({ key, status: !e ? 'missing' : isEmpty(e) ? 'empty' : 'ok', empty: isEmpty(e), line: e?.line ?? null })
    }
  }
  for (const [key, e] of file) {
    if (template?.has(key)) continue
    rows.push({ key, status: template ? 'extra' : isEmpty(e) ? 'empty' : 'ok', empty: isEmpty(e), line: e.line })
  }
  return rows
}

export function countRows(rows: readonly EnvRow[]): EnvCounts {
  const counts: EnvCounts = { ok: 0, empty: 0, missing: 0, extra: 0 }
  for (const r of rows) counts[r.status]++
  return counts
}

export interface EnvFileReport {
  name: string
  rows: EnvRow[]
  counts: EnvCounts
  error?: 'too-large' | 'unreadable'
}
export type EnvCheck =
  | {
      ok: true
      root: string
      template: { name: string; keys: { key: string; empty: boolean; line: number }[] } | null
      files: EnvFileReport[]
      truncated: boolean
    }
  | { ok: false; error: 'denied' | 'failed' }
export type EnvReveal = { ok: true; value: string } | { ok: false; error: 'denied' | 'missing' | 'too-large' | 'failed' }

async function readEnv(file: string): Promise<Map<string, EnvEntry> | 'too-large' | 'unreadable'> {
  const stat = await fs.lstat(file).catch(() => null)
  if (!stat?.isFile()) return 'unreadable'
  if (stat.size > ENV_MAX_BYTES) return 'too-large'
  const text = await fs.readFile(file, 'utf8').catch(() => null)
  return text === null ? 'unreadable' : parseEnv(text)
}

const byName = (a: string, b: string): number => (a === '.env' ? -1 : b === '.env' ? 1 : a.localeCompare(b))

/** `.env*` files directly in `root` (real path) against the first template found. Keys and flags only: values never leave here. */
export async function checkEnv(root: string): Promise<EnvCheck> {
  const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => null)
  if (!dirents) return { ok: false, error: 'failed' }
  const names = dirents.filter((d) => d.isFile() && isEnvFileName(d.name)).map((d) => d.name)
  const templateName = ENV_TEMPLATES.find((t) => names.includes(t)) ?? null
  const parsedTemplate = templateName ? await readEnv(path.join(root, templateName)) : null
  const template = parsedTemplate instanceof Map ? parsedTemplate : null
  const targets = names.filter((n) => !isEnvTemplate(n)).sort(byName)
  const files: EnvFileReport[] = []
  for (const name of targets.slice(0, ENV_MAX_FILES)) {
    const parsed = await readEnv(path.join(root, name))
    if (parsed instanceof Map) {
      const rows = compareEnv(template, parsed)
      files.push({ name, rows, counts: countRows(rows) })
    } else files.push({ name, rows: [], counts: countRows([]), error: parsed })
  }
  return {
    ok: true,
    root,
    template: templateName && template ? { name: templateName, keys: [...template].map(([key, e]) => ({ key, empty: isEmpty(e), line: e.line })) } : null,
    files,
    truncated: targets.length > ENV_MAX_FILES,
  }
}

/** One value, read again on demand: `name` must be a `.env*` file directly inside `root` and hold `key`. */
export async function revealEnv(root: string, name: unknown, key: unknown): Promise<EnvReveal> {
  if (typeof name !== 'string' || !isEnvFileName(name) || typeof key !== 'string' || !key || key.length > 256) return { ok: false, error: 'denied' }
  const real = await realOrNull(path.join(root, name))
  if (!real || rootKey(path.dirname(real)) !== rootKey(root) || path.basename(real) !== name) return { ok: false, error: 'denied' }
  const parsed = await readEnv(real)
  if (parsed === 'too-large') return { ok: false, error: 'too-large' }
  if (parsed === 'unreadable') return { ok: false, error: 'failed' }
  const entry = parsed.get(key)
  return entry ? { ok: true, value: entry.value } : { ok: false, error: 'missing' }
}
