import { execFile } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { RES_BUSY_GUARD_MS, type ResKillError, type ResKillTarget, type ResourceReport } from '@ccm/shared'
import { nativeProcessTable } from '../../../collector/src/win-procs'
import { taskkillPath } from '../pty/presets'
import { parseProcRows, treePids } from '../run/proc'

export interface KillItem {
  pid: number
  start: string
  /** Row name for the confirm: page label, else process name. */
  name: string
  ramBytes: number | null
  cmd: string
  session: boolean
  avd?: string
}

/** Every target must sit in the newest report with the same creation time; busy daemons are refused. */
export function planKill(report: ResourceReport | null, targets: readonly ResKillTarget[], now: number): { ok: true; items: KillItem[] } | { ok: false; error: ResKillError } {
  if (!report) return { ok: false, error: 'unavailable' }
  const items: KillItem[] = []
  for (const t of targets) {
    const s = report.sessions.find((x) => x.pid === t.pid && x.start === t.start)
    if (s) {
      items.push({ pid: t.pid, start: t.start, name: t.label ?? s.name ?? String(t.pid), ramBytes: s.ramBytes, cmd: '', session: true })
      continue
    }
    const v = report.servers.find((x) => x.pid === t.pid && x.start === t.start && x.start !== '')
    if (!v) return { ok: false, error: 'gone' }
    if (v.kind === 'daemon' && v.lastBusyAt !== null && now - v.lastBusyAt < RES_BUSY_GUARD_MS) return { ok: false, error: 'busy' }
    items.push({
      pid: v.pid,
      start: v.start,
      name: t.label ?? v.name,
      ramBytes: v.ramBytes,
      cmd: v.cmd,
      session: false,
      ...(v.kind === 'emulator' && v.daemon?.avd ? { avd: v.daemon.avd } : {}),
    })
  }
  return { ok: true, items }
}

export function formatRam(bytes: number | null): string {
  if (bytes === null) return '?'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

export function confirmLines(items: readonly KillItem[], sessionWord: string): string[] {
  return items.map((i) => {
    const cmd = i.cmd ? `\n   ${i.cmd.length > 140 ? `${i.cmd.slice(0, 140)}…` : i.cmd}` : ''
    return `• ${i.name}${i.session ? ` (${sessionWord})` : ''} — ${formatRam(i.ramBytes)}, pid ${i.pid}${cmd}`
  })
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true, maxBuffer: 16_000_000, env }, (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

/** Creation times read now, in the same text form the collector reports (FILETIME decimal / ps lstart in UTC); missing = gone. */
export async function liveStarts(pids: readonly number[], platform: NodeJS.Platform = process.platform): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (platform === 'win32') {
    const table = nativeProcessTable()
    if (table) {
      const want = new Set(pids)
      for (const p of table) if (want.has(p.pid) && p.start !== null) out.set(p.pid, p.start.toString())
      return out
    }
    const ps = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ')
    const text = await run(ps, ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { if ($_.CreationDate) { '{0} {1}' -f $_.ProcessId, $_.CreationDate.ToFileTimeUtc() } }`])
    for (const line of text?.split(/\r?\n/) ?? []) {
      const m = /^(\d+) (\d+)$/.exec(line.trim())
      if (m) out.set(Number(m[1]), m[2]!)
    }
    return out
  }
  const text = await run('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')], { ...process.env, LC_ALL: 'C', TZ: 'UTC' })
  for (const line of text?.split(/\r?\n/) ?? []) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (m) out.set(Number(m[1]), m[2]!.trim().replace(/\s+/g, ' '))
  }
  return out
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Windows: `taskkill /T /F`. POSIX: TERM to the tree (children first), KILL what is left after `graceMs`. */
export async function killTreeByPid(pid: number, platform: NodeJS.Platform = process.platform, graceMs = 5_000): Promise<boolean> {
  if (platform === 'win32') {
    return new Promise((resolve) => {
      execFile(taskkillPath(process.env), ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: 15_000 }, (err) => resolve(!err || !alive(pid)))
    })
  }
  const table = await run('ps', ['-A', '-o', 'pid=,ppid='])
  const pids = table ? treePids(pid, parseProcRows(table), () => false) : [pid]
  for (const p of pids) {
    try {
      process.kill(p, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  setTimeout(() => {
    for (const p of pids) {
      try {
        process.kill(p, 'SIGKILL')
      } catch {
        // exited on TERM
      }
    }
  }, graceMs).unref()
  return true
}

/** `CCM_RES_FIXTURE` (E2E): nothing real is stopped; the pids are appended to `<fixture>.killed`. */
export async function fixtureKill(fixture: string, pids: readonly number[]): Promise<void> {
  await appendFile(`${fixture}.killed`, pids.map((p) => `${p}\n`).join(''), 'utf8')
}
