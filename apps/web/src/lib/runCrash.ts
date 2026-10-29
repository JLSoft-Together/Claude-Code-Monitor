import type { RunLogLine } from '@ccm/shared'
import { sanitize } from './agentHandoff'

export type CrashKind = 'android' | 'anr' | 'flutter'

export interface CrashFrame {
  raw: string
  lang: 'jvm' | 'dart'
  symbol: string
  /** Source file name (JVM) or path inside the package / absolute path (Dart). */
  file: string
  line: number
  col?: number
  /** JVM package as a folder path, e.g. `com/example/app`. */
  pkgPath?: string
  /** Dart `package:<name>/…`; absent for `file://` frames. */
  dartPackage?: string
}

export interface CrashCause {
  exception: string
  message: string
}

export interface CrashBlock {
  kind: CrashKind
  at: number
  exception: string
  message: string
  causes: CrashCause[]
  frames: CrashFrame[]
  lines: string[]
  /** Log lines just before the crash, oldest first. */
  before: string[]
  key: string
}

export interface CrashGroup {
  key: string
  /** Newest occurrence. */
  block: CrashBlock
  count: number
  firstAt: number
}

export const BEFORE_LINES = 5
const BLOCK_MAX = 400
export const PROMPT_MAX = 4096

const THREADTIME = /^\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+\s+\d+\s+\d+\s+[VDIWEF]\s+(.+?)\s*: ?(.*)$/
const BRIEF = /^[VDIWEF]\/([^\s(:]+)\s*(?:\(\s*\d+\))?:\s?(.*)$/
const JVM_FRAME = /^\s*at\s+([\w$.<>-]+)\.([\w$<>-]+)\(([^:()]*)(?::(\d+))?\)/
const DART_PAREN = /^#\d+\s+(.+?)\s+\(((?:package:|file:\/\/|dart:)[^\s)]+?)(?::(\d+))?(?::(\d+))?\)\s*$/
const DART_TERSE = /^((?:package:|file:\/\/|dart:)\S+?)\s+(\d+)(?::(\d+))?\s+(.+)$/
const FLUTTER_OPEN = /^══╡ EXCEPTION CAUGHT BY (.+?) ╞/
const FLUTTER_CLOSE = /^═{20,}\s*$/
const DART_UNHANDLED = /\[ERROR:flutter\/[^\]]*\]\s*Unhandled Exception:\s*(.*)$/
const FRAMEWORK_PKG = /^(?:android|androidx|java|javax|kotlin|kotlinx|dalvik|libcore|sun|com\.android|com\.google\.android|org\.jetbrains|okhttp3|okio|retrofit2|io\.reactivex)(?:\.|$)/
const FRAMEWORK_DART = new Set(['flutter', 'flutter_test', 'stack_trace', 'async'])

interface Row {
  tag: string | null
  text: string
  at: number
}

/** Tag + message whether the line came pre-parsed (logcat stream) or raw (`flutter run`, custom commands). */
function rowOf(l: RunLogLine): Row {
  if (l.tag) return { tag: l.tag, text: l.text, at: l.at }
  const tt = THREADTIME.exec(l.text)
  if (tt) return { tag: tt[1]!.trim(), text: tt[2]!, at: l.at }
  const br = BRIEF.exec(l.text)
  if (br) return { tag: br[1]!, text: br[2]!, at: l.at }
  return { tag: null, text: l.text, at: l.at }
}

function jvmFrame(text: string): CrashFrame | null {
  const m = JVM_FRAME.exec(text)
  if (!m) return null
  const cls = m[1]!
  const parts = cls.split('.')
  const pkg: string[] = []
  for (const p of parts) {
    if (/^[A-Z$_]/.test(p)) break
    pkg.push(p)
  }
  const file = m[3]!.trim()
  return { raw: text.trim(), lang: 'jvm', symbol: `${cls}.${m[2]}`, file, line: m[4] ? Number(m[4]) : 0, pkgPath: pkg.length < parts.length ? pkg.join('/') : undefined }
}

function dartLocation(uri: string): { file: string; dartPackage?: string } {
  const pkg = /^package:([^/]+)\/(.+)$/.exec(uri)
  if (pkg) return { file: pkg[2]!, dartPackage: pkg[1] }
  if (uri.startsWith('file://')) {
    const p = decodeURIComponent(uri.replace(/^file:\/\/\/?/, ''))
    return { file: /^[A-Za-z]:/.test(p) ? p : `/${p.replace(/^\/+/, '')}` }
  }
  return { file: uri, dartPackage: 'dart' }
}

function dartFrame(text: string): CrashFrame | null {
  const t = text.trim()
  const m = DART_PAREN.exec(t)
  if (m) return { raw: t, lang: 'dart', symbol: m[1]!, ...dartLocation(m[2]!), line: m[3] ? Number(m[3]) : 0, col: m[4] ? Number(m[4]) : undefined }
  const n = DART_TERSE.exec(t)
  if (n) return { raw: t, lang: 'dart', symbol: n[4]!.trim(), ...dartLocation(n[1]!), line: Number(n[2]), col: n[3] ? Number(n[3]) : undefined }
  return null
}

/** `pkg.Type: message` → parts; a line with no `:` is all exception. */
function splitException(text: string): CrashCause {
  const t = text.trim()
  const m = /^([\w$.][\w$. ]{0,59}?):\s?(.*)$/.exec(t)
  if (m) return { exception: m[1]!, message: m[2]!.trim() }
  return { exception: t, message: '' }
}

function keyOf(kind: CrashKind, exception: string, frames: readonly CrashFrame[]): string {
  return [kind, exception, ...frames.slice(0, 3).map((f) => `${f.symbol}@${f.file}:${f.line}`)].join('|')
}

function beforeOf(rows: readonly Row[], start: number): string[] {
  return rows.slice(Math.max(0, start - BEFORE_LINES), start).map((r) => (r.tag ? `${r.tag}: ${r.text}` : r.text))
}

function androidBlock(rows: readonly Row[], i: number): { block: CrashBlock; end: number } {
  const tag = rows[i]!.tag
  const lines: string[] = []
  const frames: CrashFrame[] = []
  const causes: CrashCause[] = []
  let head: CrashCause | null = null
  let j = i
  for (; j < rows.length && j - i < BLOCK_MAX; j++) {
    const r = rows[j]!
    if (j > i && (r.tag !== tag || /^FATAL EXCEPTION:/.test(r.text))) break
    lines.push(r.text)
    if (j === i || /^\s*Process: /.test(r.text) || /^\s*\.\.\. \d+ more/.test(r.text)) continue
    const f = jvmFrame(r.text)
    if (f) {
      frames.push(f)
      continue
    }
    const cause = /^\s*Caused by:\s*(.*)$/.exec(r.text)
    if (cause) causes.push(splitException(cause[1]!))
    else if (!head && r.text.trim()) head = splitException(r.text)
  }
  const exception = head?.exception ?? 'FATAL EXCEPTION'
  return { block: { kind: 'android', at: rows[i]!.at, exception, message: head?.message ?? '', causes, frames, lines, before: beforeOf(rows, i), key: keyOf('android', exception, frames) }, end: j }
}

function anrBlock(rows: readonly Row[], i: number): { block: CrashBlock; end: number } {
  const tag = rows[i]!.tag
  const lines = [rows[i]!.text]
  let reason = ''
  let j = i + 1
  for (; j < rows.length && j - i < 40 && rows[j]!.tag === tag && !/^ANR in /.test(rows[j]!.text); j++) {
    lines.push(rows[j]!.text)
    const m = /^\s*Reason:\s*(.*)$/.exec(rows[j]!.text)
    if (m && !reason) reason = m[1]!.trim()
  }
  const exception = `ANR in ${rows[i]!.text.replace(/^ANR in\s+/, '').split(/\s/)[0]}`
  return { block: { kind: 'anr', at: rows[i]!.at, exception, message: reason, causes: [], frames: [], lines, before: beforeOf(rows, i), key: keyOf('anr', exception, []) }, end: j }
}

const flutterText = (r: Row): string => (r.tag === 'flutter' || r.tag === null ? r.text : `${r.tag}: ${r.text}`)

function flutterCaught(rows: readonly Row[], i: number, library: string): { block: CrashBlock; end: number } {
  const lines = [flutterText(rows[i]!)]
  const frames: CrashFrame[] = []
  let exception = ''
  let message = ''
  let j = i + 1
  for (; j < rows.length && j - i < BLOCK_MAX; j++) {
    const text = flutterText(rows[j]!)
    if (FLUTTER_OPEN.test(text)) break
    lines.push(text)
    if (FLUTTER_CLOSE.test(text)) {
      j++
      break
    }
    const f = dartFrame(text)
    if (f) {
      frames.push(f)
      continue
    }
    const thrown = /^The following (.+?) (?:was thrown|object was thrown)/.exec(text)
    if (thrown && !exception) exception = thrown[1]!.replace(/^assertion$/, 'Assertion')
    else if (exception && !message && text.trim()) message = text.trim()
  }
  exception ||= `Exception caught by ${library.toLowerCase()}`
  return { block: { kind: 'flutter', at: rows[i]!.at, exception, message, causes: [], frames, lines, before: beforeOf(rows, i), key: keyOf('flutter', exception, frames) }, end: j }
}

function flutterUnhandled(rows: readonly Row[], i: number, rest: string): { block: CrashBlock; end: number } {
  const lines = [flutterText(rows[i]!)]
  const frames: CrashFrame[] = []
  const head = splitException(rest)
  let j = i + 1
  for (; j < rows.length && j - i < BLOCK_MAX; j++) {
    const text = flutterText(rows[j]!)
    const f = dartFrame(text)
    if (f) frames.push(f)
    else if (!/^<asynchronous suspension>$/.test(text.trim()) && !(frames.length === 0 && j - i <= 3)) break
    lines.push(text)
  }
  return { block: { kind: 'flutter', at: rows[i]!.at, exception: head.exception, message: head.message, causes: [], frames, lines, before: beforeOf(rows, i), key: keyOf('flutter', head.exception, frames) }, end: j }
}

/** Crash blocks in log order: Android FATAL EXCEPTION / ANR, Flutter `EXCEPTION CAUGHT BY` and unhandled exceptions. */
export function crashBlocks(lines: readonly RunLogLine[]): CrashBlock[] {
  const rows = lines.map(rowOf)
  const out: CrashBlock[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]!
    let hit: { block: CrashBlock; end: number } | null = null
    if (/^FATAL EXCEPTION:/.test(r.text) && (r.tag === 'AndroidRuntime' || r.tag === null)) hit = androidBlock(rows, i)
    else if (/^ANR in \S/.test(r.text)) hit = anrBlock(rows, i)
    else {
      const text = flutterText(r)
      const open = FLUTTER_OPEN.exec(text)
      const unhandled = open ? null : DART_UNHANDLED.exec(text)
      if (open) hit = flutterCaught(rows, i, open[1]!)
      else if (unhandled) hit = flutterUnhandled(rows, i, unhandled[1]!)
    }
    if (hit) {
      out.push(hit.block)
      i = Math.max(hit.end, i + 1)
    } else i++
  }
  return out
}

/** Same exception + top frames folded into one row (newest kept), newest group first. */
export function groupCrashes(blocks: readonly CrashBlock[]): CrashGroup[] {
  const map = new Map<string, CrashGroup>()
  for (const b of blocks) {
    const g = map.get(b.key)
    if (g) {
      g.block = b
      g.count++
    } else map.set(b.key, { key: b.key, block: b, count: 1, firstAt: b.at })
  }
  return [...map.values()].sort((a, b) => b.block.at - a.block.at)
}

export interface FileIndex {
  byName: Map<string, string[]>
  all: readonly string[]
}

/** Project file list (root-relative, `/`) indexed by basename. */
export function fileIndex(files: readonly string[]): FileIndex {
  const byName = new Map<string, string[]>()
  for (const f of files) {
    const name = f.slice(f.lastIndexOf('/') + 1)
    const list = byName.get(name)
    if (list) list.push(f)
    else byName.set(name, [f])
  }
  return { byName, all: files }
}

const GENERATED = /(?:^|\/)(?:build|\.dart_tool|generated|intermediates)\//

/**
 * Root-relative project file a frame points at, or null for framework / unknown frames.
 * JVM: `<package path>/<File>` suffix, else the only non-generated file of that name. Dart: `lib/<path>` of the package.
 */
export function frameFile(frame: CrashFrame, index: FileIndex, root: string): string | null {
  if (frame.lang === 'jvm') {
    const pkg = frame.pkgPath?.replace(/\//g, '.') ?? ''
    if (!frame.file || !/\.(?:kt|java|kts)$/.test(frame.file) || FRAMEWORK_PKG.test(pkg)) return null
    const list = (index.byName.get(frame.file) ?? []).filter((f) => !GENERATED.test(f))
    const suffix = frame.pkgPath ? `${frame.pkgPath}/${frame.file}` : null
    const exact = suffix ? list.filter((f) => f === suffix || f.endsWith(`/${suffix}`)) : []
    if (exact.length) return exact.sort((a, b) => a.length - b.length)[0]!
    return list.length === 1 ? list[0]! : null
  }
  if (frame.dartPackage === 'dart' || (frame.dartPackage && FRAMEWORK_DART.has(frame.dartPackage))) return null
  if (!frame.dartPackage) {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
    const abs = frame.file.replace(/\\/g, '/')
    const win = /^[A-Za-z]:/.test(r)
    const same = win ? abs.toLowerCase().startsWith(`${r.toLowerCase()}/`) : abs.startsWith(`${r}/`)
    const rel = same ? abs.slice(r.length + 1) : null
    return rel && index.all.includes(rel) ? rel : null
  }
  const name = frame.file.slice(frame.file.lastIndexOf('/') + 1)
  const want = `lib/${frame.file}`
  const list = (index.byName.get(name) ?? []).filter((f) => (f === want || f.endsWith(`/${want}`)) && !GENERATED.test(f))
  return list.sort((a, b) => a.length - b.length)[0] ?? null
}

const BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const HEX = /\b[0-9a-fA-F]{32,}\b/g
const BASE64 = /\b[A-Za-z0-9+/]{32,}={0,2}(?![A-Za-z0-9+/=])/g
const KEY_VALUE = /\b((?:api[_-]?key|token|secret|password|passwd|authorization|auth|session|cookie)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi

/** Tokens, emails, long hex / base64 and `key=value` secrets masked, control chars out, ≤ `max`. */
export function redactLine(text: string, max = 300): string {
  const masked = text.replace(BEARER, '$1 [redacted]').replace(KEY_VALUE, '$1[redacted]').replace(EMAIL, '[email]').replace(HEX, '[redacted]').replace(BASE64, '[redacted]')
  return sanitize(masked, max)
}

export interface OwnFrame {
  frame: CrashFrame
  /** Absolute path. */
  path: string
}

export const PROMPT_FRAMES = 15
const OTHER_FRAMES = 5

const KIND_LABEL: Record<CrashKind, string> = { android: 'Android FATAL EXCEPTION', anr: 'Android ANR', flutter: 'Flutter exception' }

export function crashClock(at: number): string {
  const d = new Date(at)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

/**
 * Compact crash bundle for the agent's input (no trailing newline): exception, causes, top project frames as
 * `@file:line`, a few log lines before. Every line redacted; the whole text ≤ `PROMPT_MAX`.
 */
export function crashPrompt(group: CrashGroup, own: readonly OwnFrame[], mention: (path: string) => string): string {
  const b = group.block
  const out = [`App crash (${KIND_LABEL[b.kind]}) at ${crashClock(b.at)}${group.count > 1 ? ` ×${group.count}` : ''}:`]
  out.push(redactLine(b.message ? `${b.exception}: ${b.message}` : b.exception, 400))
  for (const c of b.causes.slice(0, 4)) out.push(redactLine(`Caused by: ${c.message ? `${c.exception}: ${c.message}` : c.exception}`, 300))
  if (own.length) {
    out.push('Project frames:')
    for (const o of own.slice(0, PROMPT_FRAMES)) out.push(`- ${redactLine(o.frame.symbol, 160)} ${mention(o.path)}:${o.frame.line}${o.frame.col ? `:${o.frame.col}` : ''}`)
  } else if (b.frames.length) {
    out.push('Top frames:')
    for (const f of b.frames.slice(0, OTHER_FRAMES)) out.push(`- ${redactLine(f.raw, 200)}`)
  }
  const before = b.before.map((l) => redactLine(l, 200)).filter(Boolean)
  if (before.length) out.push('Log before:', ...before.map((l) => `  ${l}`))
  let text = out.join('\n')
  if (text.length > PROMPT_MAX) text = `${text.slice(0, PROMPT_MAX - 1)}…`
  return text
}
