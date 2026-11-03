import { execFile } from 'node:child_process'
import path from 'node:path'
import type { ResKillTarget, ResourceReport, ServerRes } from '@ccm/shared'
import type { AgentServer, McpDeskError } from '../../../../packages/shared/src/mcpDesk'
import { nativeProcessTable } from '../../../collector/src/win-procs'
import { isInsideOrSame } from '../agentData/fsTree'
import { parseProcRows, treePids, type ProcRow } from '../run/proc'

/** What one pane may stop through free_port: its own process tree, its agent sessions' servers, servers working in its project. */
export interface PaneScope {
  root: string
  panePid: number | null
  tree: ReadonlySet<number>
  /** The project rule is off for a pane started at a drive root or the home folder (it would cover everything). */
  projectRule: boolean
}

export function paneScope(root: string, panePid: number | null, rows: readonly ProcRow[] | null, home: string, platform: NodeJS.Platform = process.platform): PaneScope {
  const p = platform === 'win32' ? path.win32 : path.posix
  const norm = (x: string): string => {
    const r = p.resolve(x)
    return platform === 'win32' ? r.toLowerCase() : r
  }
  const r = norm(root)
  const projectRule = r !== norm(p.parse(r).root) && r !== norm(home) && !isInsideOrSame(r, norm(home), platform)
  const tree = panePid && rows ? new Set(treePids(panePid, rows, () => false)) : new Set<number>()
  return { root, panePid, tree, projectRule }
}

export function mineOf(report: ResourceReport, scope: PaneScope, platform: NodeJS.Platform = process.platform): (s: ServerRes) => boolean {
  const sessions = new Set(report.sessions.filter((x) => scope.tree.has(x.pid)).map((x) => x.sessionId))
  return (s) =>
    s.kind !== 'emulator' &&
    (scope.tree.has(s.pid) || (s.sessionId !== null && sessions.has(s.sessionId)) || (scope.projectRule && !!s.cwd && isInsideOrSame(scope.root, s.cwd, platform)))
}

export function serversFor(report: ResourceReport, scope: PaneScope, now: number, platform: NodeJS.Platform = process.platform): { servers: AgentServer[]; outside: { port: number; name: string }[] } {
  const mine = mineOf(report, scope, platform)
  const servers = report.servers
    .filter((s) => s.ports.length > 0 || s.kind === 'dev-server')
    .map((s): AgentServer => {
      const own = mine(s)
      return {
        pid: s.pid,
        name: s.name,
        kind: s.kind,
        ports: [...new Set(s.ports.map((x) => x.port))].sort((a, b) => a - b),
        mine: own,
        ...(own && s.cmd ? { cmd: s.cmd } : {}),
        idleSec: s.idleSinceMs === null ? null : Math.max(0, Math.round((now - s.idleSinceMs) / 1000)),
        orphan: s.orphan,
      }
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine) || (a.ports[0] ?? 1e6) - (b.ports[0] ?? 1e6))
  const outside = (report.outside ?? []).flatMap((o) => [...new Set(o.ports.map((x) => x.port))].map((port) => ({ port, name: o.name })))
  return { servers, outside }
}

export type FreePortPlan = { ok: true; targets: ResKillTarget[] } | { ok: false; error: McpDeskError; detail?: string }

/** Every holder of the port must be the pane's; one foreign holder refuses the whole request (no partial stop). */
export function planFreePort(report: ResourceReport | null, scope: PaneScope, port: number, platform: NodeJS.Platform = process.platform): FreePortPlan {
  if (!report) return { ok: false, error: 'no-report' }
  const holders = report.servers.filter((s) => s.ports.some((p) => p.port === port))
  if (!holders.length) {
    const out = report.outside?.find((o) => o.ports.some((p) => p.port === port))
    return out ? { ok: false, error: 'outside', detail: out.name } : { ok: false, error: 'not-found' }
  }
  const sessionPids = new Set(report.sessions.map((s) => s.pid))
  if (holders.some((s) => s.kind === 'emulator')) return { ok: false, error: 'emulator' }
  if (holders.some((s) => s.pid === scope.panePid || sessionPids.has(s.pid) || s.pid === process.pid)) return { ok: false, error: 'self' }
  const mine = mineOf(report, scope, platform)
  const foreign = holders.find((s) => !mine(s))
  if (foreign) return { ok: false, error: 'not-mine', detail: foreign.name }
  if (holders.some((s) => !s.start)) return { ok: false, error: 'gone' }
  return { ok: true, targets: holders.map((s) => ({ pid: s.pid, start: s.start, label: `${s.name} :${port}` })) }
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true, maxBuffer: 16_000_000 }, (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

/** pid / ppid of every process, for the pane tree; null when it cannot be read. */
export async function readProcRows(platform: NodeJS.Platform = process.platform): Promise<ProcRow[] | null> {
  if (platform === 'win32') {
    const table = nativeProcessTable()
    if (table) return table.map((p) => ({ pid: p.pid, ppid: p.ppid, cmd: '' }))
    const ps = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const text = await run(ps, ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { '{0} {1}' -f $_.ProcessId,$_.ParentProcessId }"])
    return text ? parseProcRows(text) : null
  }
  const text = await run('ps', ['-A', '-o', 'pid=,ppid='])
  return text ? parseProcRows(text) : null
}
