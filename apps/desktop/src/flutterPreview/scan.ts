import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FwpEntry, FwpSkipReason } from '@ccm/shared'

export const MAX_FILES = 3000
export const MAX_FILE_BYTES = 1024 * 1024

export interface PreviewHit {
  line: number
  symbol: string
  label: string
  call: string
  skipped?: FwpSkipReason
}

/** Comments and string literals (incl. `${…}` interpolation) blanked to spaces; offsets and newlines kept. */
export function maskDart(src: string): string {
  const out = src.split('')
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  type Ctx = { kind: 'code'; depth: number } | { kind: 'str'; q: string; raw: boolean }
  const stack: Ctx[] = [{ kind: 'code', depth: 0 }]
  let strStart = -1
  let i = 0
  const n = src.length
  while (i < n) {
    const top = stack[stack.length - 1]!
    const c = src[i]!
    if (top.kind === 'code') {
      if (c === '/' && src[i + 1] === '/') {
        const nl = src.indexOf('\n', i)
        const end = nl < 0 ? n : nl
        if (stack.length === 1) blank(i, end)
        i = end
        continue
      }
      if (c === '/' && src[i + 1] === '*') {
        let depth = 0
        let j = i
        while (j < n) {
          if (src[j] === '/' && src[j + 1] === '*') {
            depth++
            j += 2
          } else if (src[j] === '*' && src[j + 1] === '/') {
            depth--
            j += 2
            if (depth === 0) break
          } else j++
        }
        if (stack.length === 1) blank(i, j)
        i = j
        continue
      }
      if (c === '"' || c === "'") {
        const raw = src[i - 1] === 'r' && !/[\w$]/.test(src[i - 2] ?? '')
        const q = src.startsWith(c.repeat(3), i) ? c.repeat(3) : c
        if (stack.length === 1) strStart = raw ? i - 1 : i
        stack.push({ kind: 'str', q, raw })
        i += q.length
        continue
      }
      if (c === '{') top.depth++
      else if (c === '}') {
        if (top.depth === 0 && stack.length > 1) {
          stack.pop()
          i++
          continue
        }
        top.depth--
      }
      i++
      continue
    }
    if (!top.raw && c === '\\') {
      i += 2
      continue
    }
    const closes = src.startsWith(top.q, i)
    const unterminated = top.q.length === 1 && c === '\n'
    if (closes || unterminated) {
      stack.pop()
      i += closes ? top.q.length : 0
      if (stack.length === 1) blank(strStart, i)
      if (unterminated) i++
      continue
    }
    if (!top.raw && c === '$' && src[i + 1] === '{') {
      stack.push({ kind: 'code', depth: 0 })
      i += 2
      continue
    }
    i++
  }
  if (stack.length > 1) blank(strStart, n)
  return out.join('')
}

const lineAt = (text: string, pos: number): number => {
  let line = 1
  for (let k = 0; k < pos; k++) if (text.charCodeAt(k) === 10) line++
  return line
}

/** Index after the bracket matching `text[open]`, or -1. */
function matchClose(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const stack: string[] = []
  for (let k = open; k < text.length; k++) {
    const c = text[k]!
    if (pairs[c]) stack.push(pairs[c]!)
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1
      if (!stack.length) return k + 1
    }
  }
  return -1
}

/** `[start, end)` of each top-level `,`-separated part (ignores nested brackets / generics). */
function topRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let depth = 0
  let from = 0
  for (let k = 0; k < text.length; k++) {
    const c = text[k]
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--
    else if (c === ',' && depth === 0) {
      ranges.push([from, k])
      from = k + 1
    }
  }
  ranges.push([from, text.length])
  return ranges
}

function splitTop(text: string): string[] {
  return topRanges(text)
    .map(([a, b]) => text.slice(a, b).trim())
    .filter(Boolean)
}

/** `name:` argument of the annotation, read only at its top level (not inside nested calls). */
function previewName(src: string, masked: string, from: number, to: number): string {
  for (const [a, b] of topRanges(masked.slice(from, to))) {
    const key = /^\s*name\s*:/.exec(masked.slice(from + a, from + b))
    if (!key) continue
    const value = /^\s*(?:'([^'\\$\n]*)'|"([^"\\$\n]*)")\s*$/.exec(src.slice(from + a + key[0].length, from + b))
    return value ? (value[1] ?? value[2] ?? '') : ''
  }
  return ''
}

export function hasRequiredParams(params: string): boolean {
  const named = params.search(/[{[]/)
  const positional = named < 0 ? params : params.slice(0, named)
  if (splitTop(positional).length) return true
  if (named < 0 || params[named] === '[') return false
  return splitTop(params.slice(named + 1, params.lastIndexOf('}'))).some((p) => /(?:^|[\s)])required\s/.test(p))
}

interface Scope {
  open: number
  close: number
  className: string | null
}

/** `{…}` bodies of top-level declarations; class-like ones carry their name. */
function topScopes(masked: string): Scope[] {
  const scopes: Scope[] = []
  let k = 0
  let segment = 0
  while (k < masked.length) {
    const c = masked[k]
    if (c === ';') segment = k + 1
    if (c === '{') {
      const close = matchClose(masked, k)
      const end = close < 0 ? masked.length : close
      const head = masked.slice(segment, k)
      const m = /\b(?:class|mixin|enum|extension(?:\s+type)?)\s+(\w+)/.exec(head)
      scopes.push({ open: k, close: end, className: m ? m[1]! : null })
      k = end
      segment = end
      continue
    }
    k++
  }
  return scopes
}

const ANNOTATION = /@(?:[A-Za-z_]\w*\.)?Preview\s*\(/g
const OTHER_ANNOTATION = /^@[A-Za-z_][\w.]*\s*/

export function scanDartSource(src: string): PreviewHit[] {
  const masked = maskDart(src)
  const scopes = topScopes(masked)
  const part = /^\s*part\s+of\b/m.test(masked)
  const hits: PreviewHit[] = []
  const seen = new Set<string>()
  ANNOTATION.lastIndex = 0
  for (let m = ANNOTATION.exec(masked); m; m = ANNOTATION.exec(masked)) {
    const at = m.index
    const argsOpen = at + m[0].length - 1
    const argsEnd = matchClose(masked, argsOpen)
    if (argsEnd < 0) continue
    ANNOTATION.lastIndex = argsEnd
    const line = lineAt(src, at)
    const label = previewName(src, masked, argsOpen + 1, argsEnd - 1)
    const scope = scopes.find((s) => at > s.open && at < s.close)
    const hit = scope ? (scope.className && depthIn(masked, scope.open, at) === 1 ? memberDecl(masked, argsEnd, scope.className) : null) : topDecl(masked, argsEnd)
    const found: Decl = hit ?? { symbol: `?${line}`, call: '', skipped: 'unknown' }
    // Importing a `part of` file breaks the host compile.
    const decl: Decl = part ? { symbol: found.symbol, call: '', skipped: 'part' } : found
    if (seen.has(decl.symbol)) continue
    seen.add(decl.symbol)
    hits.push({ line, symbol: decl.symbol, label: label.trim() || decl.symbol, call: decl.call, ...(decl.skipped ? { skipped: decl.skipped } : {}) })
  }
  return hits
}

function depthIn(masked: string, open: number, at: number): number {
  let depth = 0
  for (let k = open; k < at; k++) {
    if (masked[k] === '{') depth++
    else if (masked[k] === '}') depth--
  }
  return depth
}

interface Decl {
  symbol: string
  call: string
  skipped?: FwpSkipReason
}

/** Header (after annotations) up to the parameter list: words before `(`, the params, or null when it is not a call shape. */
function header(masked: string, from: number): { words: string[]; name: string; params: string } | null {
  let k = from
  for (;;) {
    while (/\s/.test(masked[k] ?? '')) k++
    const other = OTHER_ANNOTATION.exec(masked.slice(k, k + 200))
    if (!other) break
    k += other[0].length
    if (masked[k] === '(') {
      const end = matchClose(masked, k)
      if (end < 0) return null
      k = end
    }
  }
  let angle = 0
  for (let j = k; j < masked.length; j++) {
    const c = masked[j]
    if (c === '<') angle++
    else if (c === '>') angle--
    else if (angle === 0 && (c === '{' || c === ';' || c === '=')) return null
    else if (angle === 0 && c === '(') {
      const end = matchClose(masked, j)
      if (end < 0) return null
      const before = masked.slice(k, j).trim()
      const nameMatch = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)$/.exec(before)
      if (!nameMatch) return null
      // `Widget Function() foo()`: the first parens belong to the return type.
      if (nameMatch[1] === 'Function') {
        j = end - 1
        continue
      }
      const words = before.slice(0, nameMatch.index).trim().split(/\s+/).filter(Boolean)
      return { words, name: nameMatch[1]!, params: masked.slice(j + 1, end - 1) }
    }
  }
  return null
}

const isPrivate = (name: string): boolean => name.split('.').some((p) => p.startsWith('_'))

const MODIFIERS = new Set(['static', 'external'])
const NOT_WIDGET = new Set(['Function', 'Future', 'FutureOr', 'Stream', 'Iterable', 'List', 'Map', 'Set', 'Object', 'String', 'Null', 'Never', 'Record', 'Type'])

/** Host registry is `Widget Function()`: only a plain class-like return type (or none) compiles there. */
export function widgetReturn(words: readonly string[]): boolean {
  const type = words.filter((w) => !MODIFIERS.has(w)).join(' ')
  if (!type) return true
  const m = /^(?:[A-Za-z_]\w*\.)?([A-Z]\w*)$/.exec(type)
  // `…Builder` are typedefs of functions (WidgetBuilder, TransitionBuilder), not widgets.
  return !!m && !NOT_WIDGET.has(m[1]!) && !/.Builder$/.test(m[1]!)
}

function topDecl(masked: string, from: number): Decl | null {
  const h = header(masked, from)
  if (!h || h.name.includes('.') || h.words.some((w) => w === 'class' || w === 'get' || w === 'set' || w === 'operator')) return null
  const symbol = h.name
  if (isPrivate(symbol)) return { symbol, call: '', skipped: 'private' }
  if (!widgetReturn(h.words)) return { symbol, call: '', skipped: 'type' }
  if (hasRequiredParams(h.params)) return { symbol, call: '', skipped: 'params' }
  return { symbol, call: `${symbol}()` }
}

function memberDecl(masked: string, from: number, className: string): Decl | null {
  const h = header(masked, from)
  if (!h || h.words.includes('get') || h.words.includes('set') || h.words.includes('operator')) return null
  const ctor = h.name === className || h.name.startsWith(className + '.')
  const symbol = ctor ? h.name : `${className}.${h.name}`
  if (!ctor && (h.name.includes('.') || !h.words.includes('static'))) return { symbol, call: '', skipped: 'unknown' }
  if (isPrivate(className) || isPrivate(h.name)) return { symbol, call: '', skipped: 'private' }
  if (!ctor && !widgetReturn(h.words)) return { symbol, call: '', skipped: 'type' }
  if (hasRequiredParams(h.params)) return { symbol, call: '', skipped: 'params' }
  return { symbol, call: `${symbol}()` }
}

const SKIP_DIR = (name: string): boolean => name.startsWith('.') || name === 'build'
const SKIP_FILE = (name: string): boolean => !name.endsWith('.dart') || name.endsWith('.g.dart') || name.endsWith('.freezed.dart')
/** `package:` import paths are emitted verbatim into the host. */
export const SAFE_REL = /^lib\/[\w\-./]+\.dart$/

async function listDart(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    if (out.length >= MAX_FILES) return
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      if (out.length >= MAX_FILES) return
      const child = `${rel}/${e.name}`
      if (e.isDirectory() && !SKIP_DIR(e.name)) await walk(child)
      else if (e.isFile() && !SKIP_FILE(e.name) && SAFE_REL.test(child)) out.push(child)
    }
  }
  await walk('lib')
  return out
}

export async function scanProject(root: string): Promise<FwpEntry[]> {
  const entries: FwpEntry[] = []
  for (const file of await listDart(root)) {
    const abs = path.join(root, file)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat || stat.size > MAX_FILE_BYTES) continue
    const text = await fs.readFile(abs, 'utf8').catch(() => '')
    if (!text.includes('Preview')) continue
    for (const hit of scanDartSource(text)) entries.push({ id: `${file}#${hit.symbol}`, file, ...hit })
  }
  return entries
}
