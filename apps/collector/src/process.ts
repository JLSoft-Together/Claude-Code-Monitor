import { execFile } from 'node:child_process'

export interface ProcessInfo {
  pid: number
  creationFileTime: bigint
  parentPid?: number
  parentName?: string
}

const FILETIME_TOLERANCE = 10_000n

export function isPidAlive(pid: number): boolean {
  if (pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function procStartMatches(procStart: string | undefined, creationFileTime: bigint): boolean {
  if (procStart === undefined || !/^\d+$/.test(procStart)) return true
  const diff = BigInt(procStart) - creationFileTime
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
      creationFileTime: BigInt(r.ft),
      parentPid: typeof r.ppid === 'number' ? r.ppid : undefined,
      parentName: typeof r.pname === 'string' ? r.pname : undefined,
    })
  }
  return result
}

export function queryProcesses(pids: number[]): Promise<Map<number, ProcessInfo> | null> {
  const valid = pids.filter((p) => Number.isInteger(p) && p > 0)
  if (process.platform !== 'win32' || valid.length === 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', buildScript(valid)],
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
