import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BuildError } from '@ccm/shared'
import { defaultSpawner, killTree, type Spawner } from '../run/proc'
import { detectScripts, type ScriptSource } from './scripts'

export interface CheckRequest {
  source: ScriptSource | 'flutter'
  name: string
}

export type CheckResult =
  | { ok: true; code: number | null; ms: number; errors: BuildError[]; errorsTruncated: boolean; tail: string }
  | { ok: false; error: 'denied' | 'unknown-script' | 'busy' | 'cancelled' | 'failed'; detail?: string }

const MAX_TAIL = 64 * 1024
const MAX_LOG = 1024 * 1024
const MAX_ERRORS = 500
const MAX_RUNNING = 2
const TIMEOUT_MS = 15 * 60_000

export function cleanCheck(input: unknown): CheckRequest | null {
  const o = (input ?? {}) as { source?: unknown; name?: unknown }
  if (typeof o.source !== 'string' || typeof o.name !== 'string' || !o.name || o.name.length > 200) return null
  return { source: o.source as CheckRequest['source'], name: o.name }
}

/** The exact line to run, taken from the project's own script files; the page never sends a command. */
export async function resolveCheck(dir: string, req: CheckRequest): Promise<string | null> {
  if (req.source === 'flutter') {
    if (req.name !== 'analyze') return null
    return (await fs.stat(path.join(dir, 'pubspec.yaml')).catch(() => null))?.isFile() ? 'flutter analyze --no-pub' : null
  }
  const found = await detectScripts(dir).catch(() => null)
  const item = found?.groups.find((g) => g.source === req.source)?.items.find((i) => i.name === req.name)
  return item?.run ?? null
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/**
 * tsc / vue-tsc (`file(l,c): error TS…` and pretty `file:l:c - error TS…`), ESLint stylish (file line, then
 * `  l:c  error  msg`), Vitest (`❯ file:l:c`), dart / flutter analyze (`error • msg • file:l:c • code`) and
 * Kotlin / Gradle (`e: file:///…:l:c msg`). Unknown formats give no errors; the log tail still shows.
 */
export function parseCheckOutput(text: string, dir: string): { errors: BuildError[]; truncated: boolean } {
  const errors: BuildError[] = []
  const seen = new Set<string>()
  let truncated = false
  let eslintFile: string | null = null
  let pendingVitest: string | null = null
  const abs = (f: string): string => {
    const clean = f.replace(/^file:\/\/\/?/, '').trim()
    const local = /^[A-Za-z]:[\\/]/.test(clean) || clean.startsWith('/') ? clean : path.join(dir, clean)
    return path.normalize(process.platform === 'win32' ? local.replace(/^\/(?=[A-Za-z]:)/, '') : local)
  }
  const push = (file: string, line: number, col: number, message: string, severity: BuildError['severity']): void => {
    if (truncated) return
    const key = `${file}:${line}:${col}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    if (errors.length >= MAX_ERRORS) {
      truncated = true
      return
    }
    errors.push({ file: abs(file), line, col, message: message.trim().slice(0, 500), severity })
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(ANSI, '')
    let m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+: .*)$/.exec(line)
    if (m) {
      push(m[1]!, +m[2]!, +m[3]!, m[5]!, m[4] as BuildError['severity'])
      continue
    }
    m = /^(.+?):(\d+):(\d+) - (error|warning) (TS\d+: .*)$/.exec(line)
    if (m) {
      push(m[1]!, +m[2]!, +m[3]!, m[5]!, m[4] as BuildError['severity'])
      continue
    }
    m = /^\s*(error|warning|info)\s+[•-]\s+(.+?)\s+[•-]\s+(.+?):(\d+):(\d+)\s+[•-]\s+(\S+)\s*$/.exec(line)
    if (m) {
      if (m[1] !== 'info') push(m[3]!, +m[4]!, +m[5]!, `${m[2]} (${m[6]})`, m[1] as BuildError['severity'])
      continue
    }
    m = /^([ew]): (file:\/\/\S+?|[A-Za-z]:[\\/]\S+?|\/\S+?):(\d+):(\d+) (.*)$/.exec(line)
    if (m) {
      push(m[2]!, +m[3]!, +m[4]!, m[5]!, m[1] === 'e' ? 'error' : 'warning')
      continue
    }
    m = /^\s*❯\s+(\S+?):(\d+):(\d+)\s*$/.exec(line)
    if (m) {
      push(m[1]!, +m[2]!, +m[3]!, pendingVitest ?? 'Test failed', 'error')
      pendingVitest = null
      continue
    }
    m = /^\s*(?:AssertionError|Error|TypeError|ReferenceError)(?:\s*\[[^\]]*\])?:\s*(.+)$/.exec(line)
    if (m) {
      pendingVitest = m[1]!
      continue
    }
    if (/^(?:[A-Za-z]:[\\/]|\/)\S.*\.\w+$/.test(line.trim()) && !line.startsWith(' ')) {
      eslintFile = line.trim()
      continue
    }
    m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}\S+)?$/.exec(line)
    if (m && eslintFile) {
      push(eslintFile, +m[1]!, +m[2]!, m[4]!, m[3] as BuildError['severity'])
      continue
    }
    if (!line.trim()) eslintFile = null
  }
  return { errors, truncated }
}

interface Running {
  child: ChildProcess
  cancelled: boolean
}

/** One check per folder, at most two in the whole app; nothing runs unless the user clicked. */
export class CheckRunner {
  private readonly running = new Map<string, Running>()

  constructor(private readonly spawner: Spawner = defaultSpawner) {}

  isRunning(key: string): boolean {
    return this.running.has(key)
  }

  cancel(key: string): boolean {
    const r = this.running.get(key)
    if (!r) return false
    r.cancelled = true
    killTree(r.child)
    return true
  }

  async run(key: string, dir: string, line: string): Promise<CheckResult> {
    if (this.running.has(key) || this.running.size >= MAX_RUNNING) return { ok: false, error: 'busy' }
    const win = process.platform === 'win32'
    const spec = win
      ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], cwd: dir, verbatim: true }
      : { file: '/bin/sh', args: ['-c', line], cwd: dir }
    const started = Date.now()
    let child: ChildProcess
    try {
      child = this.spawner(spec)
    } catch (err) {
      return { ok: false, error: 'failed', detail: String(err).slice(0, 300) }
    }
    const entry: Running = { child, cancelled: false }
    this.running.set(key, entry)
    let log = ''
    const take = (chunk: Buffer): void => {
      log += chunk.toString('utf8')
      if (log.length > MAX_LOG) log = log.slice(-MAX_LOG)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        entry.cancelled = true
        killTree(child)
      }, TIMEOUT_MS)
      child.once('error', (err) => {
        log += `\n${String(err)}`
        clearTimeout(timer)
        resolve(null)
      })
      child.once('close', (c) => {
        clearTimeout(timer)
        resolve(c)
      })
    })
    this.running.delete(key)
    if (entry.cancelled) return { ok: false, error: 'cancelled' }
    const parsed = parseCheckOutput(log, dir)
    return { ok: true, code, ms: Date.now() - started, errors: parsed.errors, errorsTruncated: parsed.truncated, tail: log.slice(-MAX_TAIL).replace(ANSI, '') }
  }

  dispose(): void {
    for (const key of [...this.running.keys()]) this.cancel(key)
  }
}
