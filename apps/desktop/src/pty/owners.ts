import { execFile } from 'node:child_process'
import path from 'node:path'
import { nativeProcessTable, type WinProc } from '../../../collector/src/win-procs'

const ROW = /^\s*(\d+)\s+(\d+)\s*$/
const MAX_DEPTH = 32

export function parsePidTable(stdout: string): Map<number, number> {
  const parents = new Map<number, number>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = ROW.exec(line)
    if (m) parents.set(Number(m[1]), Number(m[2]))
  }
  return parents
}

/** For each pid, the root it descends from (itself included), walking ppid links. */
export function ownersOf<T>(pids: number[], roots: Map<number, T>, parents: Map<number, number>): Map<number, T> {
  const out = new Map<number, T>()
  for (const pid of pids) {
    let cur: number | undefined = pid
    for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
      const owner = roots.get(cur)
      if (owner !== undefined) {
        out.set(pid, owner)
        break
      }
      const next = parents.get(cur)
      cur = next === cur ? undefined : next
    }
  }
  return out
}

function tableCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): [string, string[]] {
  if (platform === 'win32') {
    const ps = path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const script = "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { '{0} {1}' -f $_.ProcessId,$_.ParentProcessId }"
    return [ps, ['-NoProfile', '-NonInteractive', '-Command', script]]
  }
  return ['/bin/ps', ['-A', '-o', 'pid=', '-o', 'ppid=']]
}

export function readPidTable(
  platform = process.platform,
  env = process.env,
  native: () => WinProc[] | null = nativeProcessTable,
): Promise<Map<number, number> | null> {
  const table = platform === 'win32' ? native() : null
  if (table) return Promise.resolve(new Map(table.map((p) => [p.pid, p.ppid])))
  const [file, args] = tableCommand(platform, env)
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : parsePidTable(stdout))
    })
  })
}
