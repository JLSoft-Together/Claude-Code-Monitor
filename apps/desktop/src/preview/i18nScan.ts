import type { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isWithin } from './paths'

export const I18N_MAX_FILES = 400
export const I18N_MAX_BYTES = 1024 * 1024
export const I18N_MAX_DIRS = 4000
export const I18N_MAX_KEYS = 500
const MAX_DEPTH = 10

const SKIP_DIRS = new Set([
  'node_modules', 'build', '.git', '.gradle', '.idea', '.dart_tool', '.pub-cache', 'dist', 'out', 'Pods', '.next', '.nuxt', '.svelte-kit',
  'coverage', 'vendor', 'target', '.venv', 'venv', '__pycache__', '.cxx', 'intermediates', 'generated', '.vitest', 'release',
])
const JSON_DIRS = new Set(['locales', 'i18n', 'lang'])
const ANDROID_LOCALE = /^values-([a-z]{2,3}(?:-r[A-Z]{2})?|b\+[A-Za-z0-9+]+)$/
// Android UI-mode qualifiers that look like a 3-letter language code.
const NOT_LOCALES = new Set(['car'])

export type I18nKind = 'android' | 'flutter' | 'json'
export interface I18nKey {
  key: string
  /** Relative to the project root, forward slashes. */
  file: string
  line: number
}
export type I18nIssue = 'missing' | 'extra' | 'same'
export interface I18nLocale {
  locale: string
  files: string[]
  keys: number
  counts: Record<I18nIssue, number>
  /** At most I18N_MAX_KEYS per kind; `counts` has the full numbers. */
  missing: I18nKey[]
  extra: I18nKey[]
  same: I18nKey[]
  error?: 'invalid' | 'too-large'
}
export interface I18nSet {
  kind: I18nKind
  /** Folder of the resource set, relative to the root ('' = the root). */
  dir: string
  base: { locale: string; files: string[]; keys: number; error?: 'invalid' | 'too-large' }
  locales: I18nLocale[]
}
export type I18nScan = { ok: true; root: string; sets: I18nSet[]; truncated: boolean } | { ok: false; error: 'denied' | 'failed' }

export interface I18nEntry {
  value: string
  line: number
  /** Android `translatable="false"`: never missing nor "same". */
  fixed?: boolean
}
type Entries = Map<string, I18nEntry>

/** `<string>`, `<plurals>` and `<string-array>` names of an Android values XML; comments blanked first so lines hold. */
export function parseAndroidStrings(xml: string): Entries {
  const text = xml.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
  const out: Entries = new Map()
  const re = /<(string|plurals|string-array)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/g
  let last = 0
  let line = 1
  for (const m of text.matchAll(re)) {
    const name = /\bname\s*=\s*"([^"]+)"/.exec(m[2] ?? '')?.[1]
    if (!name) continue
    for (let i = last; i < (m.index ?? 0); i++) if (text.charCodeAt(i) === 10) line++
    last = m.index ?? 0
    const fixed = /\btranslatable\s*=\s*"false"/.test(m[2] ?? '')
    out.set(name, { value: (m[3] ?? '').trim(), line, ...(fixed ? { fixed } : {}) })
  }
  return out
}

/**
 * JSON object → leaf keys flattened with dots, each with the line of its key. Arrays and non-string leaves count as
 * one value. Null when the text is not a JSON object.
 */
export function parseJsonKeys(text: string): Entries | null {
  const out: Entries = new Map()
  let i = 0
  let line = 1
  const src = text.replace(/^﻿/, '')
  const ws = (): void => {
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '\n') line++
      else if (c !== ' ' && c !== '\t' && c !== '\r') break
    }
  }
  const str = (): string => {
    if (src[i] !== '"') throw new Error('string')
    const start = ++i
    for (; i < src.length && src[i] !== '"'; i++) {
      if (src[i] === '\\') i++
      else if (src[i] === '\n') throw new Error('newline')
    }
    if (i >= src.length) throw new Error('eof')
    return JSON.parse(`"${src.slice(start, i++)}"`) as string
  }
  const value = (key: string | null, keyLine: number): void => {
    ws()
    const c = src[i]
    const start = i
    if (c === '{') {
      i++
      ws()
      if (src[i] === '}') {
        i++
        return
      }
      for (;;) {
        ws()
        const at = line
        const k = str()
        ws()
        if (src[i++] !== ':') throw new Error(':')
        value(key === null ? null : key ? `${key}.${k}` : k, at)
        ws()
        if (src[i] === ',') i++
        else if (src[i] === '}') {
          i++
          return
        } else throw new Error(',')
      }
    }
    let leaf: string
    if (c === '[') {
      i++
      ws()
      if (src[i] === ']') i++
      else
        for (;;) {
          value(null, line)
          ws()
          if (src[i] === ',') i++
          else if (src[i++] === ']') break
          else throw new Error(']')
        }
      leaf = src.slice(start, i)
    } else if (c === '"') leaf = str()
    else {
      const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(src.slice(i, i + 64))
      if (!m) throw new Error('literal')
      i += m[0].length
      leaf = m[0]
    }
    if (key) out.set(key, { value: leaf, line: keyLine })
  }
  try {
    ws()
    if (src[i] !== '{') return null
    value('', 1)
    ws()
    return i === src.length ? out : null
  } catch {
    return null
  }
}

/** ARB: the JSON keys minus `@key` metadata and `@@locale`. */
export function parseArb(text: string): { entries: Entries; locale: string | null } | null {
  const all = parseJsonKeys(text)
  if (!all) return null
  const entries: Entries = new Map()
  let locale: string | null = null
  for (const [k, e] of all) {
    if (k === '@@locale') locale = e.value
    else if (!k.startsWith('@')) entries.set(k, e)
  }
  return { entries, locale }
}

/** Worth flagging as untranslated: at least 3 letters once placeholders, tags and entities are gone. */
export function isWordy(value: string): boolean {
  const bare = value.replace(/\{[^}]*\}|%(?:\d+\$)?[a-z]|<[^>]+>|&\w+;|\\[nt'"@]/gi, '')
  return (bare.match(/\p{L}/gu)?.length ?? 0) >= 3
}

export function compareLocale(base: Entries, entries: Entries, baseFile: string, file: string): Pick<I18nLocale, 'counts' | 'missing' | 'extra' | 'same'> {
  const counts = { missing: 0, extra: 0, same: 0 }
  const missing: I18nKey[] = []
  const extra: I18nKey[] = []
  const same: I18nKey[] = []
  const push = (list: I18nKey[], kind: I18nIssue, k: I18nKey): void => {
    counts[kind]++
    if (list.length < I18N_MAX_KEYS) list.push(k)
  }
  for (const [key, b] of base) {
    if (b.fixed) continue
    const e = entries.get(key)
    if (!e) push(missing, 'missing', { key, file: baseFile, line: b.line })
    else if (e.value === b.value && isWordy(b.value)) push(same, 'same', { key, file, line: e.line })
  }
  for (const [key, e] of entries) if (!base.has(key)) push(extra, 'extra', { key, file, line: e.line })
  return { counts, missing, extra, same }
}

/** Reads a small text file: null when missing, a symlink or not a file, 'too-large' past the cap. */
async function readSmall(file: string, budget: { files: number }): Promise<string | null | 'too-large'> {
  if (budget.files <= 0) return null
  const stat = await fs.lstat(file).catch(() => null)
  if (!stat?.isFile()) return null
  if (stat.size > I18N_MAX_BYTES) return 'too-large'
  budget.files--
  return fs.readFile(file, 'utf8').catch(() => null)
}

const rel = (root: string, p: string): string => path.relative(root, p).split(path.sep).join('/')

interface Found {
  android: string[]
  flutter: string[]
  json: string[]
  truncated: boolean
}

async function walk(root: string): Promise<Found> {
  const found: Found = { android: [], flutter: [], json: [], truncated: false }
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length) {
    const { dir, depth } = queue.shift()!
    if (++visited > I18N_MAX_DIRS) {
      found.truncated = true
      break
    }
    const ents: Dirent[] | null = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!ents) continue
    const name = path.basename(dir)
    if (ents.some((e) => e.isFile() && e.name === 'pubspec.yaml')) found.flutter.push(dir)
    if (name === 'res' && ents.some((e) => e.isDirectory() && e.name === 'values')) {
      found.android.push(dir)
      continue
    }
    if (JSON_DIRS.has(name.toLowerCase()) && ents.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json')).length >= 2) found.json.push(dir)
    if (depth >= MAX_DEPTH) continue
    for (const e of ents) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !(e.name.startsWith('.') && e.name !== '.')) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 })
  }
  return found
}

type Loaded = { entries: Entries; file: string } | { error: 'invalid' | 'too-large'; file: string } | null

async function scanAndroid(root: string, res: string, budget: { files: number }): Promise<I18nSet | null> {
  const load = async (dir: string): Promise<Loaded> => {
    const file = path.join(res, dir, 'strings.xml')
    const text = await readSmall(file, budget)
    if (text === null) return null
    return text === 'too-large' ? { error: 'too-large', file: rel(root, file) } : { entries: parseAndroidStrings(text), file: rel(root, file) }
  }
  const base = await load('values')
  if (!base) return null
  const dirs = (await fs.readdir(res, { withFileTypes: true }).catch(() => [] as Dirent[]))
    .filter((e) => e.isDirectory() && ANDROID_LOCALE.test(e.name) && !NOT_LOCALES.has(e.name.slice(7)))
    .map((e) => e.name)
    .sort()
  const locales: { locale: string; loaded: NonNullable<Loaded> }[] = []
  for (const d of dirs) {
    const loaded = await load(d)
    if (loaded) locales.push({ locale: d.slice(7), loaded })
  }
  return buildSet('android', rel(root, res), 'default', base, locales)
}

function buildSet(kind: I18nKind, dir: string, baseLocale: string, base: NonNullable<Loaded>, locales: { locale: string; loaded: NonNullable<Loaded> }[]): I18nSet {
  const baseEntries = 'entries' in base ? base.entries : null
  return {
    kind,
    dir,
    base: { locale: baseLocale, files: [base.file], keys: baseEntries?.size ?? 0, ...('error' in base ? { error: base.error } : {}) },
    locales: locales.map(({ locale, loaded }) => {
      const head = { locale, files: [loaded.file] }
      if ('error' in loaded) return { ...head, keys: 0, counts: { missing: 0, extra: 0, same: 0 }, missing: [], extra: [], same: [], error: loaded.error }
      const cmp = baseEntries ? compareLocale(baseEntries, loaded.entries, base.file, loaded.file) : { counts: { missing: 0, extra: 0, same: 0 }, missing: [], extra: [], same: [] }
      return { ...head, keys: loaded.entries.size, ...cmp }
    }),
  }
}

/** `key: value` of a flat YAML file (l10n.yaml), quotes and trailing comments dropped. */
export function yamlValue(text: string, key: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw)
    if (!m || m[1] !== key) continue
    const v = m[2]!.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2')
    return v || null
  }
  return null
}

async function scanFlutter(root: string, project: string, budget: { files: number }): Promise<I18nSet | null> {
  const yaml = await readSmall(path.join(project, 'l10n.yaml'), budget)
  const conf = typeof yaml === 'string' ? yaml : ''
  const arbDir = path.resolve(project, yamlValue(conf, 'arb-dir') ?? path.join('lib', 'l10n'))
  if (!isWithin(project, arbDir)) return null
  const template = path.basename(yamlValue(conf, 'template-arb-file') ?? 'app_en.arb')
  const names = (await fs.readdir(arbDir, { withFileTypes: true }).catch(() => [] as Dirent[])).filter((e) => e.isFile() && e.name.endsWith('.arb')).map((e) => e.name).sort()
  if (!names.includes(template)) return null
  const load = async (name: string): Promise<{ loaded: NonNullable<Loaded>; locale: string | null }> => {
    const file = path.join(arbDir, name)
    const text = await readSmall(file, budget)
    if (text === 'too-large') return { loaded: { error: 'too-large', file: rel(root, file) }, locale: null }
    const arb = text === null ? null : parseArb(text)
    return arb ? { loaded: { entries: arb.entries, file: rel(root, file) }, locale: arb.locale } : { loaded: { error: 'invalid', file: rel(root, file) }, locale: null }
  }
  const prefix = /^(.*_)[^_]+\.arb$/.exec(template)?.[1] ?? ''
  const localeOf = (name: string, fromFile: string | null): string => fromFile ?? (prefix && name.startsWith(prefix) ? name.slice(prefix.length, -4) : name.slice(0, -4))
  const base = await load(template)
  const locales: { locale: string; loaded: NonNullable<Loaded> }[] = []
  for (const n of names) {
    if (n === template) continue
    const l = await load(n)
    locales.push({ locale: localeOf(n, l.locale), loaded: l.loaded })
  }
  return buildSet('flutter', rel(root, arbDir), localeOf(template, base.locale), base.loaded, locales)
}

const EN_FIRST = ['en.json', 'en-us.json', 'en_us.json', 'en-gb.json']

async function scanJson(root: string, dir: string, budget: { files: number }): Promise<I18nSet | null> {
  const names = (await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]))
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map((e) => e.name)
    .sort()
  const baseName = EN_FIRST.map((n) => names.find((x) => x.toLowerCase() === n)).find(Boolean) ?? names[0]
  if (!baseName) return null
  const load = async (name: string): Promise<NonNullable<Loaded>> => {
    const file = path.join(dir, name)
    const text = await readSmall(file, budget)
    if (text === 'too-large') return { error: 'too-large', file: rel(root, file) }
    const entries = text === null ? null : parseJsonKeys(text)
    return entries ? { entries, file: rel(root, file) } : { error: 'invalid', file: rel(root, file) }
  }
  const base = await load(baseName)
  if ('error' in base && base.error === 'invalid') return null
  const locales: { locale: string; loaded: NonNullable<Loaded> }[] = []
  for (const n of names) if (n !== baseName) locales.push({ locale: n.slice(0, -5), loaded: await load(n) })
  return buildSet('json', rel(root, dir), baseName.slice(0, -5), base, locales)
}

/**
 * Translation resources under `root` (a real, allowed folder): Android `res/values*\/strings.xml`, Flutter ARB (l10n.yaml
 * or lib/l10n) and JSON locale folders. TS / JS locale modules are not parsed. Bounded by folder, file and size caps.
 */
export async function scanI18n(root: string): Promise<I18nScan> {
  const stat = await fs.stat(root).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, error: 'failed' }
  const found = await walk(root)
  const budget = { files: I18N_MAX_FILES }
  const sets: I18nSet[] = []
  for (const res of found.android) {
    const s = await scanAndroid(root, res, budget)
    if (s) sets.push(s)
  }
  for (const p of found.flutter) {
    const s = await scanFlutter(root, p, budget)
    if (s && !sets.some((x) => x.kind === 'flutter' && x.dir === s.dir)) sets.push(s)
  }
  for (const d of found.json) {
    const s = await scanJson(root, d, budget)
    if (s) sets.push(s)
  }
  return { ok: true, root, sets, truncated: found.truncated || budget.files <= 0 }
}
