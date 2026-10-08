import { execFile } from 'node:child_process'
import path from 'node:path'

export type ProcessStart = { kind: 'filetime'; value: bigint } | { kind: 'lstart'; value: string }

export interface ProcessInfo {
  pid: number
  start: ProcessStart
  parentPid?: number
  parentName?: string
}

const FILETIME_TOLERANCE = 10_000n
const LSTART = /^\w{3}\s+\w{3}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4}$/
const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\s*$/
const PS_NAME_ROW = /^\s*(\d+)\s+(.+)$/

export function isPidAlive(pid: number): boolean {
  if (pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const squash = (s: string): string => s.trim().replace(/\s+/g, ' ')

// A procStart in a format we do not know keeps the session (only PID-reuse protection is lost).
export function procStartMatches(procStart: string | undefined, start: ProcessStart): boolean {
  if (procStart === undefined) return true
  if (start.kind === 'lstart') return !LSTART.test(procStart.trim()) || squash(procStart) === squash(start.value)
  if (!/^\d+$/.test(procStart)) return true
  const diff = BigInt(procStart) - start.value
  return diff <= FILETIME_TOLERANCE && diff >= -FILETIME_TOLERANCE
}

function buildScript(pids: number[]): string {
  const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ')
  return [
    `$ps = @(Get-CimInstance Win32_Process -Filter "${filter}")`,
    `$parentIds = @($ps | ForEach-Object { $_.ParentProcessId } | Sort-Object -Unique)`,
    `$names = @{}`,
    `if ($parentIds.Count -gt 0) { Get-CimInstance Win32_Process -Filter (($parentIds | ForEach-Object { "ProcessId=$_" }) -join ' OR ') | ForEach-Object { $names[[int]$_.ProcessId] = $_.Name } }`,
    `$out = @($ps | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ft = $_.CreationDate.ToFileTimeUtc().ToString(); ppid = [int]$_.ParentProcessId; pname = $names[[int]$_.ParentProcessId] } })`,
    `ConvertTo-Json -Compress -InputObject $out`,
  ].join('; ')
}

export function parseProcessQueryOutput(stdout: string): Map<number, ProcessInfo> {
  const result = new Map<number, ProcessInfo>()
  const text = stdout.trim()
  if (!text) return result
  const parsed: unknown = JSON.parse(text)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    if (typeof r.pid !== 'number' || typeof r.ft !== 'string' || !/^\d+$/.test(r.ft)) continue
    result.set(r.pid, {
      pid: r.pid,
      start: { kind: 'filetime', value: BigInt(r.ft) },
      parentPid: typeof r.ppid === 'number' ? r.ppid : undefined,
      parentName: typeof r.pname === 'string' ? r.pname : undefined,
    })
  }
  return result
}

// macOS prints the full executable path, login shells a leading dash ("-zsh").
const commName = (comm: string): string => path.posix.basename(comm.trim()).replace(/^-/, '')

/** Parses `ps -o pid=,ppid=,lstart=` (LC_ALL=C). */
export function parsePsOutput(stdout: string): Map<number, ProcessInfo> {
  const result = new Map<number, ProcessInfo>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = PS_ROW.exec(line)
    if (!m) continue
    const pid = Number(m[1])
    result.set(pid, { pid, start: { kind: 'lstart', value: squash(m[3]!) }, parentPid: Number(m[2]) })
  }
  return result
}

/** Parses `ps -o pid=,comm=`. */
export function parsePsNames(stdout: string): Map<number, string> {
  const result = new Map<number, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = PS_NAME_ROW.exec(line)
    if (m) result.set(Number(m[1]), commName(m[2]!))
  }
  return result
}

function runPs(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    // Same locale/zone Claude Code uses when it records procStart.
    const env = { ...process.env, LC_ALL: 'C', TZ: 'UTC' }
    execFile('ps', args, { timeout: 8_000, maxBuffer: 1_000_000, env }, (err, stdout, stderr) => {
      // ps exits 1 without stderr when some pids are gone; anything else (missing ps, bad option, timeout) is unknown.
      if (err && (typeof err.code !== 'number' || String(stderr).trim())) return resolve(null)
      resolve(String(stdout))
    })
  })
}

async function queryProcessesUnix(pids: number[]): Promise<Map<number, ProcessInfo> | null> {
  const out = await runPs(['-o', 'pid=,ppid=,lstart=', '-p', pids.join(',')])
  if (out === null) return null
  const info = parsePsOutput(out)
  const parents = [...new Set([...info.values()].map((p) => p.parentPid).filter((p): p is number => !!p && p > 1))]
  if (parents.length === 0) return info
  const names = parsePsNames((await runPs(['-o', 'pid=,comm=', '-p', parents.join(',')])) ?? '')
  for (const p of info.values()) if (p.parentPid !== undefined) p.parentName = names.get(p.parentPid)
  return info
}

function queryProcessesWindows(pids: number[]): Promise<Map<number, ProcessInfo> | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', buildScript(pids)],
      { timeout: 8_000, windowsHide: true, maxBuffer: 1_000_000 },
      (err, stdout) => {
        if (err) return resolve(null)
        try {
          resolve(parseProcessQueryOutput(stdout))
        } catch {
          resolve(null)
        }
      },
    )
  })
}

export function queryProcesses(pids: number[]): Promise<Map<number, ProcessInfo> | null> {
  const valid = pids.filter((p) => Number.isInteger(p) && p > 0)
  if (valid.length === 0) return Promise.resolve(null)
  if (process.platform === 'win32') return queryProcessesWindows(valid)
  if (process.platform === 'darwin' || process.platform === 'linux') return queryProcessesUnix(valid)
  return Promise.resolve(null)
}
