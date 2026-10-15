import { execFile } from 'node:child_process'
import path from 'node:path'
import { windowsPowerShell } from '../win-exe'
import { nativeCommandLine, nativeProcessTable, type WinProc } from '../win-procs'

export type ProcessMode = 'exec' | 'tui' | 'app-server' | 'other'

export interface CodexProcess {
  pid: number
  /** Creation time in ms (1 s resolution on macOS / Linux). */
  start: number
  mode: ProcessMode
  resumeId?: string
  /** Parent chain, nearest first, only through parents created before their child (guards PID reuse). */
  ancestors: number[]
  /**
   * The chain is cut right above a shell or script runtime whose parent is gone (MSYS `exec` hand-off, a subshell
   * that exited). A chain that tops out at a GUI app (terminal, editor) is a user-started run, never an orphan.
   */
  orphan: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALUE_FLAGS = new Set([
  '-c', '--config', '-m', '--model', '-p', '--profile', '-s', '--sandbox', '-a', '--ask-for-approval', '-C', '--cd',
  '-i', '--image', '--add-dir', '--enable', '--disable', '--local-provider', '--remote', '--remote-auth-token-env',
  '--output-schema', '--color', '-o', '--output-last-message',
])
const OTHER_COMMANDS = new Set([
  'login', 'logout', 'mcp', 'mcp-server', 'completion', 'sandbox', 'debug', 'apply', 'a', 'cloud', 'features', 'help',
  'update', 'plugin', 'marketplace', 'proto', 'responses-api-proxy', 'stdio-to-uds', 'generate-ts', 'generate-json-schema',
])
const MAX_ANCESTORS = 16
const SHELLISH = new Set([
  'bash', 'sh', 'dash', 'zsh', 'fish', 'timeout', 'env', 'xargs', 'nohup', 'time', 'script', 'node', 'bun', 'deno',
  'python', 'python3', 'py', 'cmd', 'powershell', 'pwsh', 'npx', 'npm', 'codex',
])

const isShellish = (name: string | undefined): boolean => !!name && SHELLISH.has(name.toLowerCase().replace(/\.exe$/, ''))

// FILETIME counts 100 ns ticks from 1601-01-01.
const FILETIME_EPOCH_OFFSET = 11_644_473_600_000n

/** Splits a command line the way the C runtime does for the cases that matter here (quoted args, no escapes). */
export function splitArgs(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let has = false
  for (const ch of cmd) {
    if (ch === '"') {
      quoted = !quoted
      has = true
    } else if (!quoted && (ch === ' ' || ch === '\t')) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

function positionals(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--') break
    if (a.startsWith('-')) {
      if (!a.includes('=') && VALUE_FLAGS.has(a)) i++
      continue
    }
    out.push(a)
  }
  return out
}

/** Subcommand and resumed thread id; the command line itself is never kept (prompts can be passed as arguments). */
export function modeOfCommandLine(cmd: string): { mode: ProcessMode; resumeId?: string } {
  const pos = positionals(splitArgs(cmd).slice(1))
  const first = pos[0]
  if (first === 'exec' || first === 'e') {
    const resumeId = pos[1] === 'resume' && pos[2] && UUID_RE.test(pos[2]) ? pos[2] : undefined
    return { mode: 'exec', resumeId }
  }
  if (first === 'resume' || first === 'fork') return { mode: 'tui', resumeId: first === 'resume' && pos[1] && UUID_RE.test(pos[1]) ? pos[1] : undefined }
  if (first === 'app-server') return { mode: 'app-server' }
  if (first === 'review') return { mode: 'exec' }
  if (first && OTHER_COMMANDS.has(first)) return { mode: 'other' }
  return { mode: 'tui' }
}

/** Drops helper processes started by another codex process (sandbox runners re-exec the same binary). */
function topLevel(list: CodexProcess[]): CodexProcess[] {
  const pids = new Set(list.map((p) => p.pid))
  return list.filter((p) => !p.ancestors.some((a) => pids.has(a)))
}

const WINDOWS_SCRIPT = [
  `$all = @{}`,
  `Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name | ForEach-Object { $all[[int]$_.ProcessId] = $_ }`,
  `$out = @(Get-CimInstance Win32_Process -Filter "Name='codex.exe'" -Property ProcessId,ParentProcessId,CreationDate,CommandLine | ForEach-Object {`,
  `  $anc = New-Object System.Collections.Generic.List[int]; $c = $_; $cut = $false`,
  `  for ($i = 0; $i -lt ${MAX_ANCESTORS}; $i++) { $p = $all[[int]$c.ParentProcessId]; if (-not $p -or $p.CreationDate -gt $c.CreationDate) { $cut = [int]$c.ParentProcessId -gt 4; break }; $anc.Add([int]$p.ProcessId); $c = $p }`,
  `  [pscustomobject]@{ pid = [int]$_.ProcessId; ft = $_.CreationDate.ToFileTimeUtc().ToString(); anc = $anc.ToArray(); cut = $cut; top = [string]$c.Name; cmd = [string]$_.CommandLine }`,
  `})`,
  `ConvertTo-Json -Compress -Depth 3 -InputObject $out`,
].join('\n')

export function parseWindowsProcesses(stdout: string): CodexProcess[] {
  const text = stdout.trim()
  if (!text) return []
  const parsed: unknown = JSON.parse(text)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const out: CodexProcess[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    if (typeof r.pid !== 'number' || typeof r.ft !== 'string' || !/^\d+$/.test(r.ft)) continue
    const anc = Array.isArray(r.anc) ? r.anc : typeof r.anc === 'number' ? [r.anc] : []
    out.push({
      pid: r.pid,
      start: Number(BigInt(r.ft) / 10_000n - FILETIME_EPOCH_OFFSET),
      ...modeOfCommandLine(typeof r.cmd === 'string' ? r.cmd : ''),
      ancestors: anc.filter((a): a is number => typeof a === 'number' && a > 0),
      orphan: r.cut === true && isShellish(typeof r.top === 'string' ? r.top : undefined),
    })
  }
  return topLevel(out)
}

/**
 * The CIM script's walk over a native table. Null when a codex.exe can't be opened (elevated / other user): the
 * caller then asks CIM, which reads every process.
 */
export function windowsCodexProcesses(table: WinProc[], commandLine: (pid: number) => string | null): CodexProcess[] | null {
  const all = new Map(table.map((p) => [p.pid, p]))
  const newer = (a: WinProc, b: WinProc): boolean => a.start !== null && b.start !== null && a.start > b.start
  const out: CodexProcess[] = []
  for (const proc of table) {
    if (proc.name.toLowerCase() !== 'codex.exe') continue
    const cmd = proc.start === null ? null : commandLine(proc.pid)
    if (proc.start === null || cmd === null) return null
    const ancestors: number[] = []
    let cur = proc
    let cut = false
    for (let i = 0; i < MAX_ANCESTORS; i++) {
      const parent = all.get(cur.ppid)
      if (!parent || parent.pid === cur.pid || newer(parent, cur)) {
        cut = cur.ppid > 4 && parent?.pid !== cur.pid
        break
      }
      ancestors.push(parent.pid)
      cur = parent
    }
    out.push({
      pid: proc.pid,
      start: Number(proc.start / 10_000n - FILETIME_EPOCH_OFFSET),
      ...modeOfCommandLine(cmd),
      ancestors: ancestors.filter((a) => a > 0),
      orphan: cut && isShellish(cur.name),
    })
  }
  return topLevel(out)
}

const PS_ALL_ROW = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/
const PS_ARGS_ROW = /^\s*(\d+)\s+(.*)$/

interface PsRow {
  ppid: number
  start: number
  name: string
}

/** Parses `ps -A -o pid=,ppid=,lstart=,comm=` (LC_ALL=C, TZ=UTC). */
export function parsePsAll(stdout: string): Map<number, PsRow> {
  const rows = new Map<number, PsRow>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = PS_ALL_ROW.exec(line)
    if (!m) continue
    const start = Date.parse(`${m[3]!.replace(/\s+/g, ' ')} UTC`)
    if (!Number.isFinite(start)) continue
    rows.set(Number(m[1]), { ppid: Number(m[2]), start, name: path.posix.basename(m[4]!.trim()).replace(/^-/, '') })
  }
  return rows
}

export function unixCodexProcesses(all: Map<number, PsRow>, argsOut: string): CodexProcess[] {
  const args = new Map<number, string>()
  for (const line of argsOut.split(/\r?\n/)) {
    const m = PS_ARGS_ROW.exec(line)
    if (m) args.set(Number(m[1]), m[2]!)
  }
  const out: CodexProcess[] = []
  for (const [pid, row] of all) {
    if (row.name !== 'codex') continue
    const ancestors: number[] = []
    let cur = row
    let cut = false
    for (let i = 0; i < MAX_ANCESTORS; i++) {
      const parent = all.get(cur.ppid)
      // Reparented to init/launchd also means the launching process is gone.
      if (!parent || cur.ppid <= 1 || parent.start > cur.start) {
        cut = cur.ppid === 1 || (cur.ppid > 1 && (!parent || parent.start > cur.start))
        break
      }
      ancestors.push(cur.ppid)
      cur = parent
    }
    out.push({ pid, start: row.start, ...modeOfCommandLine(args.get(pid) ?? ''), ancestors, orphan: cut && isShellish(cur.name) })
  }
  return topLevel(out)
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8_000, windowsHide: true, maxBuffer: 4_000_000, env }, (err, stdout) => {
      resolve(err ? null : String(stdout))
    })
  })
}

/** All running Codex CLI processes, or null when the platform query failed (callers keep their last view). */
export async function listCodexProcesses(platform: NodeJS.Platform = process.platform): Promise<CodexProcess[] | null> {
  if (platform === 'win32') {
    const table = nativeProcessTable()
    const native = table && windowsCodexProcesses(table, nativeCommandLine)
    if (native) return native
    const out = await run(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT])
    if (out === null) return null
    try {
      return parseWindowsProcesses(out)
    } catch {
      return null
    }
  }
  if (platform !== 'darwin' && platform !== 'linux') return null
  const env = { ...process.env, LC_ALL: 'C', TZ: 'UTC' }
  const all = await run('ps', ['-A', '-o', 'pid=,ppid=,lstart=,comm='], env)
  if (all === null) return null
  const table = parsePsAll(all)
  const pids = [...table].filter(([, r]) => r.name === 'codex').map(([pid]) => pid)
  const argsOut = pids.length ? ((await run('ps', ['-o', 'pid=,args=', '-p', pids.join(',')], env)) ?? '') : ''
  return unixCodexProcesses(table, argsOut)
}
