import { parseAndroidXml, setAndroidString } from './androidXml'
import { parseJsonStrings, setJsonString } from './jsonStrings'
import type { StringEntry, StringKind, StringsDoc, WriteResult } from './types'

export type SourceKind = 'android' | 'flutter' | 'json'

export function parseSource(kind: SourceKind, text: string): StringsDoc {
  if (kind === 'android') return parseAndroidXml(text)
  return parseJsonStrings(text, kind === 'flutter') ?? { entries: new Map(), order: [], writable: false, reason: 'invalid' }
}

export function setSourceString(kind: SourceKind, text: string, key: string, value: string): WriteResult {
  return kind === 'android' ? setAndroidString(text, key, value) : setJsonString(text, key, value, kind === 'flutter')
}

const ANDROID_FMT = /%(?:(\d+)\$)?[-#+ 0,(]*\d*(?:\.\d+)?([a-zA-Z%])/g

/** Format args of an Android string, unnumbered ones numbered in order: `%s %d` = `%1$s %2$d`. */
export function androidPlaceholders(value: string): string[] {
  const out = new Set<string>()
  let next = 1
  for (const m of value.matchAll(ANDROID_FMT)) {
    const conv = m[2]!
    if (conv === '%' || conv === 'n') continue
    const pos = m[1] ? Number(m[1]) : next++
    out.add(`%${pos}$${conv}`)
  }
  return [...out].sort()
}

/** ICU argument names (`{name}`, `{count, plural, …}` and arguments nested in plural / select cases). */
export function icuPlaceholders(value: string): string[] {
  const out = new Set<string>()
  let i = 0
  const message = (untilClose: boolean): void => {
    while (i < value.length) {
      const c = value[i]
      if (c === '}' && untilClose) return
      if (c === "'" && /['{}]/.test(value[i + 1] ?? '')) {
        if (value[i + 1] === "'") i += 2
        else {
          const end = value.indexOf("'", i + 1)
          i = end < 0 ? value.length : end + 1
        }
        continue
      }
      if (c === '{') {
        i++
        argument()
        continue
      }
      i++
    }
  }
  const argument = (): void => {
    const m = /^\s*([^\s,{}]+)\s*/.exec(value.slice(i))
    if (!m) {
      skipTo()
      return
    }
    out.add(m[1]!)
    i += m[0].length
    if (value[i] === '}') {
      i++
      return
    }
    if (value[i] !== ',') {
      skipTo()
      return
    }
    i++
    const t = /^\s*([a-z]+)\s*/.exec(value.slice(i))
    i += t?.[0].length ?? 0
    if (t && /^(plural|select|selectordinal)$/.test(t[1]!) && value[i] === ',') {
      i++
      while (i < value.length && value[i] !== '}') {
        const sel = /^[^{}]*\{/.exec(value.slice(i))
        if (!sel) break
        i += sel[0].length
        message(true)
        i++
        while (/\s/.test(value[i] ?? '')) i++
      }
      if (value[i] === '}') i++
      return
    }
    skipTo()
  }
  const skipTo = (): void => {
    let depth = 1
    for (; i < value.length && depth > 0; i++) {
      if (value[i] === '{') depth++
      else if (value[i] === '}') depth--
    }
  }
  message(false)
  return [...out].sort()
}

export function placeholdersOf(kind: SourceKind, value: string): string[] {
  return kind === 'android' ? androidPlaceholders(value) : icuPlaceholders(value)
}

export interface LocaleSource {
  locale: string
  /** Absolute path. */
  path: string
  /** Relative to the project root. */
  rel: string
  mtimeMs: number
  text: string
  doc: StringsDoc
}

export type CellState = 'ok' | 'missing' | 'absent' | 'fixed'

export interface Cell {
  state: CellState
  entry?: StringEntry
  /** Placeholders differ from the base locale's. */
  mismatch?: { base: string[]; here: string[] }
  editable: boolean
}

export interface Row {
  key: string
  kind: StringKind
  fixed: boolean
  /** Key only in translations, not in the base file. */
  extra: boolean
  cells: Cell[]
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** Key × locale grid; `sources[0]` is the base locale. Base keys keep file order, translation-only keys follow. */
export function buildRows(kind: SourceKind, sources: readonly LocaleSource[]): Row[] {
  const base = sources[0]
  if (!base) return []
  const keys = [...base.doc.order]
  const known = new Set(keys)
  for (const s of sources.slice(1)) for (const k of s.doc.order) if (!known.has(k)) known.add(k), keys.push(k)
  return keys.map((key) => {
    const b = base.doc.entries.get(key)
    const fixed = !!b?.fixed
    const basePh = b?.kind === 'string' ? placeholdersOf(kind, b.value) : null
    const cells = sources.map((s, i): Cell => {
      const e = s.doc.entries.get(key)
      if (e) {
        const here = i > 0 && basePh && e.kind === 'string' ? placeholdersOf(kind, e.value) : null
        const mismatch = here && basePh && !same(here, basePh) ? { base: basePh, here } : undefined
        return { state: 'ok', entry: e, editable: s.doc.writable && e.editable, ...(mismatch ? { mismatch } : {}) }
      }
      const addable = s.doc.writable && (!b || b.kind === 'string')
      if (fixed && i > 0) return { state: 'fixed', editable: false }
      return { state: b ? 'missing' : 'absent', editable: addable && !!b }
    })
    return { key, kind: b?.kind ?? sources.map((s) => s.doc.entries.get(key)?.kind).find(Boolean) ?? 'string', fixed, extra: !b, cells }
  })
}

export const rowMissing = (r: Row): boolean => r.cells.some((c) => c.state === 'missing')
export const rowWarn = (r: Row): boolean => rowMissing(r) || r.cells.some((c) => !!c.mismatch)

export function filterRows(rows: readonly Row[], opts: { missingOnly: boolean; query: string }): Row[] {
  const q = opts.query.trim().toLowerCase()
  return rows.filter((r) => {
    if (opts.missingOnly && !rowWarn(r)) return false
    if (!q) return true
    return r.key.toLowerCase().includes(q) || r.cells.some((c) => c.entry?.value.toLowerCase().includes(q))
  })
}

export function missingCounts(rows: readonly Row[], locales: number): number[] {
  const out = new Array<number>(locales).fill(0)
  for (const r of rows) r.cells.forEach((c, i) => c.state === 'missing' && out[i]!++)
  return out
}

export const FILL_MAX = 6000

/**
 * Prefill text asking the agent to translate the missing keys of `targets` (indexes into `sources`); null when nothing
 * is missing there. Never submitted: the owner reads it and presses Enter.
 */
export function fillPrompt(kind: SourceKind, sources: readonly LocaleSource[], rows: readonly Row[], targets: readonly number[]): string | null {
  const base = sources[0]
  if (!base) return null
  const blocks: string[] = []
  let count = 0
  for (const ti of targets) {
    const s = sources[ti]
    if (!s || ti === 0) continue
    const lines = rows.filter((r) => r.cells[ti]?.state === 'missing').map((r) => `- ${r.key}: ${JSON.stringify(r.cells[0]?.entry?.value ?? '')}${r.kind === 'string' ? '' : ` (${r.kind})`}`)
    if (!lines.length) continue
    count += lines.length
    blocks.push(`${s.locale} → ${s.rel}\n${lines.join('\n')}`)
  }
  if (!count) return null
  const how =
    kind === 'android'
      ? "Keep placeholders like %1$s / %d, Android escaping (\\' \\n) and the file's formatting; add the strings where they fit."
      : 'Keep ICU placeholders like {name} / {count, plural, …} and the file\'s key order and indent; do not add @key metadata to translations.'
  let text = `Translate these ${count} missing strings from ${base.locale} (${base.rel}) and add them to each locale file. ${how} Do not change other keys.\n\n${blocks.join('\n\n')}`
  if (text.length > FILL_MAX) text = `${text.slice(0, FILL_MAX).replace(/\n[^\n]*$/, '')}\n…`
  return text
}

export const hasTargetsMissing = (rows: readonly Row[], i: number): boolean => rows.some((r) => r.cells[i]?.state === 'missing')

/** Explorer rows that open the strings table: a `res` / `values*` / `l10n` / locale folder, strings.xml, .arb, l10n.yaml. */
export function isStringsPath(name: string, directory: boolean): boolean {
  const n = name.toLowerCase()
  if (directory) return n === 'res' || n === 'l10n' || /^values(-|$)/.test(n) || n === 'locales' || n === 'i18n' || n === 'lang'
  return n === 'strings.xml' || n.endsWith('.arb') || n === 'l10n.yaml'
}
