import { execFile } from 'node:child_process'
import path from 'node:path'
import { windowsPowerShell } from '../win-exe'
import { winProcs, type WinProcApi } from '../win-procs'

/** One process of the machine-wide table; `cmd` undefined = not read yet, null = unreadable. */
export interface ProcRow {
  pid: number
  ppid: number
  name: string
  /** Creation time as text (FILETIME decimal / ps lstart): with the pid it tells a reused pid apart. */
  start: string | null
  startMs: number | null
  ramBytes: number | null
  cpuMs: number | null
  cmd?: string | null
}

export interface ProcReader {
  read(): Promise<ProcRow[] | null>
  /** Fills usage and command lines for these pids when `read` left them out (native Windows path). */
  enrich(rows: readonly ProcRow[], usage: ReadonlySet<number>, cmd: ReadonlySet<number>): void
}

export const procKey = (row: Pick<ProcRow, 'pid' | 'start'>): string | null => (row.start === null ? null : `${row.pid}:${row.start}`)

const FILETIME_EPOCH_MS = 11_644_473_600_000

export function filetimeMs(ft: bigint): number {
  return Number(ft / 10_000n) - FILETIME_EPOCH_MS
}

/** `ps` cputime: `[[dd-]hh:]mm:ss[.cc]` (Linux `00:01:02`, macOS `1:02.33`). */
export function parseCpuTime(text: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!m) return null
  const [, d, h, min, s] = m
  return ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(min)) * 60_000 + Math.round(Number(s) * 1000)
}

const LSTART_RE = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d\d:\d\d:\d\d)\s+(\d{4})$/

function lstartMs(lstart: string): number | null {
  const m = LSTART_RE.exec(lstart)
  if (!m) return null
  const ms = Date.parse(`${m[1]} ${m[2]} ${m[4]} ${m[3]} UTC`)
  return Number.isFinite(ms) ? ms : null
}

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/

// Paths with spaces ("/Applications/Android Studio.app/…") make argv[0] ambiguous; the name only feeds classification.
const argv0Name = (cmd: string): string => path.posix.basename(cmd.trim().split(/\s+/)[0] ?? '').replace(/^-/, '')

/** Parses `ps -A -o pid=,ppid=,rss=,time=,lstart=,command=` run with LC_ALL=C TZ=UTC. */
export function parsePsTable(stdout: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = PS_ROW.exec(line)
    if (!m) continue
    const start = m[5]!.replace(/\s+/g, ' ')
    const cmd = m[6]!.trim()
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      name: argv0Name(cmd),
      start,
      startMs: lstartMs(start),
      ramBytes: Number(m[3]) * 1024,
      cpuMs: parseCpuTime(m[4]!),
      cmd,
    })
  }
  return rows
}

const CIM_SCRIPT = [
  '$out = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{',
  'pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = $_.Name;',
  'ft = $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc().ToString() } else { $null });',
  'ws = $(if ($null -ne $_.WorkingSetSize) { [double]$_.WorkingSetSize } else { $null });',
  'cpu = $(if ($null -ne $_.KernelModeTime -and $null -ne $_.UserModeTime) { [double]($_.KernelModeTime + $_.UserModeTime) / 10000 } else { $null });',
  'cmd = $_.CommandLine } });',
  'ConvertTo-Json -Compress -InputObject $out',
].join(' ')

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** Parses the CIM fallback's JSON (`CCM_NATIVE_PROCS=0` or koffi missing). */
export function parseCimTable(stdout: string): ProcRow[] {
  const text = stdout.trim()
  if (!text) return []
  const parsed: unknown = JSON.parse(text)
  const rows: ProcRow[] = []
  for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    if (typeof r.pid !== 'number' || typeof r.ppid !== 'number') continue
    const ft = typeof r.ft === 'string' && /^\d+$/.test(r.ft) ? r.ft : null
    rows.push({
      pid: r.pid,
      ppid: r.ppid,
      name: typeof r.name === 'string' ? r.name : '',
      start: ft,
      startMs: ft ? filetimeMs(BigInt(ft)) : null,
      ramBytes: numOrNull(r.ws),
      cpuMs: numOrNull(r.cpu),
      cmd: typeof r.cmd === 'string' ? r.cmd : null,
    })
  }
  return rows
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true, maxBuffer: 16_000_000, env }, (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

const noEnrich = (): void => undefined

export function psReader(): ProcReader {
  return {
    async read() {
      const out = await run('ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,lstart=,command='], { ...process.env, LC_ALL: 'C', TZ: 'UTC' })
      return out === null ? null : parsePsTable(out)
    },
    enrich: noEnrich,
  }
}

export function cimReader(): ProcReader {
  return {
    async read() {
      const out = await run(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', CIM_SCRIPT])
      if (out === null) return null
      try {
        return parseCimTable(out)
      } catch {
        return null
      }
    },
    enrich: noEnrich,
  }
}

/** koffi path: the table first, then usage / command lines only for the pids the report needs. */
export function nativeReader(api: WinProcApi, fallback: ProcReader = cimReader()): ProcReader {
  const cmds = new Map<string, string | null>()
  let usingFallback = false
  return {
    async read() {
      let table
      try {
        table = api.list()
      } catch {
        usingFallback = true
        return fallback.read()
      }
      usingFallback = false
      const live = new Set<string>()
      const rows = table.map((p): ProcRow => {
        const start = p.start === null ? null : p.start.toString()
        const row: ProcRow = { pid: p.pid, ppid: p.ppid, name: p.name, start, startMs: p.start === null ? null : filetimeMs(p.start), ramBytes: null, cpuMs: null }
        const key = procKey(row)
        if (key) live.add(key)
        if (key && cmds.has(key)) row.cmd = cmds.get(key)
        return row
      })
      for (const key of cmds.keys()) if (!live.has(key)) cmds.delete(key)
      return rows
    },
    enrich(rows, usage, cmd) {
      if (usingFallback) return
      for (const row of rows) {
        if (usage.has(row.pid)) {
          let u = null
          try {
            u = api.usage(row.pid)
          } catch {
            u = null
          }
          row.ramBytes = u?.workingSet ?? null
          row.cpuMs = u?.cpuMs ?? null
        }
        if (cmd.has(row.pid) && row.cmd === undefined) {
          let c: string | null = null
          try {
            c = api.commandLine(row.pid)
          } catch {
            c = null
          }
          row.cmd = c
          const key = procKey(row)
          if (key) cmds.set(key, c)
        }
      }
    },
  }
}

export function defaultProcReader(): ProcReader | null {
  if (process.platform === 'win32') {
    const api = winProcs()
    return api ? nativeReader(api) : cimReader()
  }
  if (process.platform === 'darwin' || process.platform === 'linux') return psReader()
  return null
}
