import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { childEnv, taskkillPath } from '../pty/presets'
import type { SubstituteVars } from './args'
import { nativeCommandLine, nativeProcessTable, type WinProc } from '../../../collector/src/win-procs'

export interface SpawnSpec {
  file: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  /** win32 `cmd.exe /d /s /c "<line>"` already quoted (gradlewSpawn / flutterSpawn); Node must not re-quote it. */
  verbatim?: boolean
  /** Outlives the app (emulator): own group, no pipes, unref'd. */
  detached?: boolean
  /** Only the JSON-RPC children (`flutter run --machine`, `flutter daemon`) get a writable stdin. */
  stdin?: 'pipe' | 'ignore'
}

export type Spawner = (spec: SpawnSpec) => ChildProcess

export function runEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...childEnv(base), ...extra }
  // Gradle/Flutter colour + progress bars would land in the log panel as escape garbage.
  delete env.TERM
  delete env.COLORTERM
  delete env.FORCE_HYPERLINK
  return { ...env, NO_COLOR: '1' }
}

/** `${env:NAME}` sees what the child gets (filtered app env + config env), never CCM_* / ELECTRON_* of the app itself. */
export function substVars(projectDir: string, workspaceDir: string, base: NodeJS.ProcessEnv, cfgEnv: Record<string, string>, maskEnv = false): SubstituteVars {
  return { projectDir, workspaceDir, env: runEnv(base, cfgEnv), ...(maskEnv ? { maskEnv } : {}) }
}

export const defaultSpawner: Spawner = (spec) => {
  if (spec.detached) {
    const child = spawn(spec.file, spec.args, { cwd: spec.cwd, env: runEnv(process.env, spec.env), windowsHide: true, shell: false, stdio: 'ignore', detached: true })
    child.unref()
    return child
  }
  return spawn(spec.file, spec.args, {
    cwd: spec.cwd,
    env: runEnv(process.env, spec.env),
    windowsHide: true,
    shell: false,
    windowsVerbatimArguments: spec.verbatim === true,
    stdio: [spec.stdin ?? 'ignore', 'pipe', 'pipe'],
    // POSIX: own process group so killTree can signal gradle/flutter children too.
    detached: process.platform !== 'win32',
  })
}

const taskkill = (pids: number[], tree: boolean, sync: boolean): void => {
  const args = [...(tree ? ['/T'] : []), '/F', ...pids.flatMap((p) => ['/PID', String(p)])]
  if (sync) {
    try {
      execFileSync(taskkillPath(process.env), args, { windowsHide: true, timeout: 2_500, stdio: 'ignore' })
    } catch {
      // already gone
    }
  } else execFile(taskkillPath(process.env), args, { windowsHide: true }, () => undefined)
}

/** Kills the child and its descendants. Runs even when only the wrapper (cmd.exe / gradlew) has exited: its children may live on. */
export function killTree(child: ChildProcess, sync = false): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') return taskkill([pid], true, sync)
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

export interface ProcRow {
  pid: number
  ppid: number
  cmd: string
}

export function parseProcRows(stdout: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s?(.*)$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] ?? '' })
  }
  return rows
}

/** Descendants of `root` (root included), children before parents; a spared process and its subtree are left out. */
export function treePids(root: number, rows: readonly ProcRow[], spare: (cmd: string) => boolean): number[] {
  const kids = new Map<number, ProcRow[]>()
  const self = rows.find((r) => r.pid === root)
  for (const r of rows) {
    if (r.pid === r.ppid) continue
    const list = kids.get(r.ppid)
    if (list) list.push(r)
    else kids.set(r.ppid, [r])
  }
  const out: number[] = []
  const seen = new Set<number>()
  const walk = (pid: number, depth: number): void => {
    if (seen.has(pid) || depth > 64) return
    seen.add(pid)
    for (const k of kids.get(pid) ?? []) if (!spare(k.cmd)) walk(k.pid, depth + 1)
    out.push(pid)
  }
  if (self && spare(self.cmd)) return []
  walk(root, 0)
  return out
}

/** Rows for treePids from the native table: command lines only for root's subtree, the only ones `spare` sees. */
export function nativeProcRows(root: number, table: WinProc[] | null, commandLine: (pid: number) => string | null): ProcRow[] | null {
  if (!table) return null
  const kids = new Map<number, number[]>()
  for (const p of table) if (p.pid !== p.ppid) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid])
  const subtree = new Set<number>()
  const stack = [root]
  while (stack.length && subtree.size < 4096) {
    const pid = stack.pop()!
    if (subtree.has(pid)) continue
    subtree.add(pid)
    stack.push(...(kids.get(pid) ?? []))
  }
  const rows: ProcRow[] = []
  for (const p of table) {
    if (!subtree.has(p.pid)) {
      rows.push({ pid: p.pid, ppid: p.ppid, cmd: '' })
      continue
    }
    const cmd = commandLine(p.pid)
    if (cmd === null) return null
    rows.push({ pid: p.pid, ppid: p.ppid, cmd })
  }
  return rows
}

function procTableCommand(env: NodeJS.ProcessEnv): [string, string[]] {
  const ps = path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CommandLine | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId,$_.ParentProcessId,($_.CommandLine -replace '[\\r\\n]',' ') }"
  return [ps, ['-NoProfile', '-NonInteractive', '-Command', script]]
}

/**
 * win32 tree kill that leaves processes matching `spare` (the Gradle daemon, which `taskkill /T` would take down
 * with the gradlew client) running. POSIX needs nothing special: the daemon calls setsid() and is outside our group.
 * Falls back to a full tree kill when the process table can't be read; `onFallback` reports that.
 */
export function killTreeSparing(child: ChildProcess, spare: RegExp, opts: { sync?: boolean; onFallback?: () => void } = {}): void {
  const pid = child.pid
  const sync = opts.sync === true
  if (!pid || process.platform !== 'win32') return killTree(child, sync)
  const finish = (stdout: string | null, parsed?: ProcRow[]): void => {
    const rows = parsed ?? (stdout ? parseProcRows(stdout) : [])
    if (!rows.length) {
      opts.onFallback?.()
      return killTree(child, sync)
    }
    const pids = treePids(pid, rows, (cmd) => spare.test(cmd))
    if (pids.length) taskkill(pids, false, sync)
  }
  const native = nativeProcRows(pid, nativeProcessTable(), nativeCommandLine)
  if (native) return finish(null, native)
  const [file, args] = procTableCommand(process.env)
  if (sync) {
    let out: string | null = null
    try {
      out = execFileSync(file, args, { windowsHide: true, timeout: 5_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      out = null
    }
    return finish(out)
  }
  execFile(file, args, { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => finish(err ? null : String(stdout)))
}
