import type { BuildError } from '@ccm/shared'
import { pathKey } from './changesView'
import { joinPath } from './fileLinks'

export const SCAN_MAX_LINES = 5000
export const SCAN_MAX_PROBLEMS = 1000

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const ABS = /^(?:[A-Za-z]:[\\/]|[\\/])/
type Severity = BuildError['severity']
const sev = (s: string): Severity => (/warn/i.test(s) ? 'warning' : 'error')

/** `file:///C:/a%20b/x.kt` / `/C:/x` / relative → absolute path of the terminal's machine; null for internals. */
export function resolveProblemPath(raw: string, cwd: string | null): string | null {
  let f = raw.trim().replace(/^["'(]+|["')]+$/g, '')
  if (/^file:\/\//i.test(f)) {
    f = f.replace(/^file:\/\/(?:localhost)?/i, '')
    try {
      f = decodeURIComponent(f)
    } catch {
      // keep as is
    }
  }
  f = f.replace(/^\/(?=[A-Za-z]:[\\/])/, '')
  if (!f || /^(?:node|internal|bun|deno):/.test(f) || f.startsWith('<')) return null
  if (ABS.test(f)) return joinPath(f, '')
  return cwd ? joinPath(cwd, f) : null
}

interface BufferLike {
  length: number
  getLine(i: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined
}

/** Last `max` logical lines of an xterm buffer: soft-wrapped rows joined back, so long paths stay whole. */
export function bufferLines(buf: BufferLike, max = SCAN_MAX_LINES): string[] {
  const out: string[] = []
  for (let i = Math.max(0, buf.length - max * 4); i < buf.length; i++) {
    const row = buf.getLine(i)
    if (!row) continue
    const text = row.translateToString(true)
    if (row.isWrapped && out.length) out[out.length - 1] += text
    else out.push(text)
  }
  return out.length > max ? out.slice(-max) : out
}

export interface TerminalScan {
  errors: BuildError[]
  files: number
  truncated: boolean
}

/**
 * Problems in terminal text: tsc (plain + pretty), ESLint stylish, dart analyze (both layouts), Kotlin / Gradle
 * (`e: file:///…:l:c` and `e: path: (l, c):`), gcc-style `file:l:c: error:`, pytest `file.py:l: Error`, Vitest `❯ file:l:c`
 * and the first own frame of a Node stack (`at fn (file:l:c)`, node_modules / internals skipped).
 */
export function parseTerminalProblems(input: readonly string[], cwd: string | null): TerminalScan {
  const lines = input.length > SCAN_MAX_LINES ? input.slice(-SCAN_MAX_LINES) : input
  const errors: BuildError[] = []
  const seen = new Set<string>()
  let truncated = false
  let eslintFile: string | null = null
  let lastError: string | null = null
  let inStack = false

  const push = (file: string, line: number, col: number, message: string, severity: Severity): boolean => {
    const abs = resolveProblemPath(file, cwd)
    if (!abs || !(line > 0)) return false
    const msg = message.trim().slice(0, 500)
    const key = `${abs}:${line}:${col}:${msg}`
    if (seen.has(key)) return true
    if (errors.length >= SCAN_MAX_PROBLEMS) {
      truncated = true
      return true
    }
    seen.add(key)
    errors.push({ file: abs, line, col: col > 0 ? col : 1, message: msg, severity })
    return true
  }

  for (const raw of lines) {
    const line = raw.replace(ANSI, '').replace(/\s+$/, '')
    const frame = /^\s+at (?:(.+?) \()?((?:file:\/\/\/?)?(?:[A-Za-z]:)?[^():]+?):(\d+):(\d+)\)?$/.exec(line)
    if (frame) {
      if (!inStack && !/[\\/]node_modules[\\/]/.test(frame[2]!) && push(frame[2]!, +frame[3]!, +frame[4]!, lastError ?? (frame[1] ? `at ${frame[1]}` : 'Error'), 'error')) inStack = true
      continue
    }
    inStack = false
    let m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+: .*)$/.exec(line) ?? /^(.+?):(\d+):(\d+) - (error|warning) (TS\d+: .*)$/.exec(line)
    if (m) {
      push(m[1]!, +m[2]!, +m[3]!, m[5]!, sev(m[4]!))
      continue
    }
    m = /^\s*(error|warning|info)\s+-\s+(.+?):(\d+):(\d+)\s+-\s+(.+?)(?:\s+-\s+(\w+))?$/.exec(line)
    if (m) {
      if (m[1] !== 'info') push(m[2]!, +m[3]!, +m[4]!, m[6] ? `${m[5]} (${m[6]})` : m[5]!, sev(m[1]!))
      continue
    }
    m = /^\s*(error|warning|info)\s+•\s+(.+?)\s+•\s+(.+?):(\d+):(\d+)\s+•\s+(\S+)$/.exec(line)
    if (m) {
      if (m[1] !== 'info') push(m[3]!, +m[4]!, +m[5]!, `${m[2]} (${m[6]})`, sev(m[1]!))
      continue
    }
    m = /^([ew]): (file:\/\/\S+?|[A-Za-z]:[\\/]\S+?|\/\S+?):(\d+):(\d+) (.*)$/.exec(line) ?? /^([ew]): (.+?): \((\d+), (\d+)\): (.*)$/.exec(line)
    if (m) {
      push(m[2]!, +m[3]!, +m[4]!, m[5]!, m[1] === 'e' ? 'error' : 'warning')
      continue
    }
    m = /^((?:[A-Za-z]:)?[^\s:][^:]*?):(\d+):(\d+):\s*(error|warning|fatal error):\s*(.+)$/.exec(line)
    if (m) {
      push(m[1]!, +m[2]!, +m[3]!, m[5]!, sev(m[4]!))
      continue
    }
    m = /^(\S+?\.py):(\d+): (\w*(?:Error|Exception|Failed|Failure)\b.*)$/.exec(line)
    if (m) {
      push(m[1]!, +m[2]!, 1, m[3]!, 'error')
      continue
    }
    m = /^\s*❯\s+(\S+?):(\d+):(\d+)$/.exec(line)
    if (m) {
      push(m[1]!, +m[2]!, +m[3]!, lastError ?? 'Test failed', 'error')
      continue
    }
    if (!line.startsWith(' ') && /^(?:[A-Za-z]:[\\/]|\/)\S.*\.\w+$/.test(line)) {
      eslintFile = line
      continue
    }
    m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}\S+)?$/.exec(line)
    if (m && eslintFile) {
      push(eslintFile, +m[1]!, +m[2]!, m[4]!, sev(m[3]!))
      continue
    }
    if (!line.trim()) eslintFile = null
    const err = /^\s*(?:Uncaught )?((?:[A-Z]\w*)?(?:Error|Exception)(?:\s*\[[^\]]*\])?:\s*.+)$/.exec(line)
    if (err) lastError = err[1]!.slice(0, 300)
  }
  return { errors, files: new Set(errors.map((e) => pathKey(e.file))).size, truncated }
}
