import type { DaemonInfo, ResKind, ResPort } from '@ccm/shared'
import { procKey, type ProcRow } from './procs'

export interface SessionRoot {
  sessionId: string
  pid: number
}

export interface SessionTree {
  sessionId: string
  root: ProcRow
  members: ProcRow[]
}

export interface ServerEntry {
  root: ProcRow
  /** Process whose name / command line the row shows (the node under a shell, not the shell). */
  main: ProcRow
  members: ProcRow[]
  kind: ResKind
  sessionId: string | null
  orphan: boolean
  ports: ResPort[]
  daemon?: DaemonInfo
}

export interface TreeResult {
  sessions: SessionTree[]
  servers: ServerEntry[]
  /** procKey → sessionId for every descendant of a live session this pass. */
  seen: Map<string, string>
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd', 'nu'])
const CONSOLE_HOSTS = new Set(['conhost', 'openconsole'])
const DAEMON_HOSTS = new Set(['java', 'javaw', 'dart', 'dartaotruntime', 'dartvm', 'emulator'])

export const baseName = (name: string): string => name.toLowerCase().replace(/\.exe$/, '')
export const isShell = (name: string): boolean => SHELLS.has(baseName(name))

/** Rows whose command line decides whether they are a daemon / emulator (read before the tree is built). */
export function mayBeDaemon(name: string): boolean {
  const n = baseName(name)
  return DAEMON_HOSTS.has(n) || n.startsWith('qemu-system')
}

const JDK_RE = /([^\\/"\s]+)[\\/](?:Contents[\\/]Home[\\/])?(?:jre[\\/])?bin[\\/]javaw?(?:\.exe)?(?=["\s]|$)/i
const GRADLE_RE = /GradleDaemon\s+(\d+(?:\.\d+)+(?:-[\w.]+)?)/
const GRADLE_CP_RE = /gradle-(?:launcher|daemon-main)-(\d+(?:\.\d+)+(?:-[\w.]+)?)\.jar|gradle-(\d+(?:\.\d+)+(?:-[\w.]+)?)[\\/]lib[\\/]/
const KOTLIN_CP_RE = /kotlin-(?:compiler-embeddable|compiler|daemon|daemon-embeddable)-(\d+\.\d+(?:\.\d+)?(?:-[\w]+)?)\.jar/
const AVD_RE = /(?:^|\s)-avd\s+"?([A-Za-z0-9._-]{1,100})"?/
const PORT_RE = /(?:^|\s)-port\s+(\d{4,5})(?=\s|$)/

function jdkOf(cmd: string): string | undefined {
  return JDK_RE.exec(cmd)?.[1]
}

/** Gradle / Kotlin daemons, Dart analysis server, flutter daemon, Android emulator; null for anything else. */
export function daemonOf(name: string, cmd: string | null | undefined): DaemonInfo | null {
  if (!mayBeDaemon(name) || !cmd) return null
  const n = baseName(name)
  if (n === 'emulator' || n.startsWith('qemu-system')) {
    const avd = AVD_RE.exec(cmd)?.[1]
    const port = PORT_RE.exec(cmd)?.[1]
    if (!avd && !port) return null
    return { type: 'emulator', ...(avd ? { avd } : {}), ...(port ? { serial: `emulator-${port}` } : {}) }
  }
  if (cmd.includes('org.gradle.launcher.daemon.bootstrap.GradleDaemon')) {
    const cp = GRADLE_CP_RE.exec(cmd)
    const version = GRADLE_RE.exec(cmd)?.[1] ?? cp?.[1] ?? cp?.[2]
    const jdk = jdkOf(cmd)
    return { type: 'gradle', ...(version ? { version } : {}), ...(jdk ? { jdk } : {}) }
  }
  if (cmd.includes('KotlinCompileDaemon')) {
    const version = KOTLIN_CP_RE.exec(cmd)?.[1]
    const jdk = jdkOf(cmd)
    return { type: 'kotlin', ...(version ? { version } : {}), ...(jdk ? { jdk } : {}) }
  }
  if (/flutter_tools\.snapshot\b/.test(cmd) && /\sdaemon(?:\s|$)/.test(cmd)) return { type: 'flutter' }
  if (/\banalysis_server\b|\slanguage-server(?:\s|$)/.test(cmd)) return { type: 'dart' }
  return null
}

interface Forest {
  byPid: Map<number, ProcRow>
  children: Map<number, ProcRow[]>
  parentOf: (row: ProcRow) => ProcRow | undefined
}

// Windows keeps a dead parent's pid in ppid; a "parent" created after its child is a reused pid, not the parent.
function forest(rows: readonly ProcRow[]): Forest {
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const parentOf = (row: ProcRow): ProcRow | undefined => {
    if (row.ppid === row.pid) return undefined
    const p = byPid.get(row.ppid)
    if (!p) return undefined
    if (p.startMs !== null && row.startMs !== null && p.startMs > row.startMs) return undefined
    return p
  }
  const children = new Map<number, ProcRow[]>()
  for (const r of rows) {
    const p = parentOf(r)
    if (!p) continue
    const list = children.get(p.pid)
    if (list) list.push(r)
    else children.set(p.pid, [r])
  }
  return { byPid, children, parentOf }
}

function subtree(root: ProcRow, f: Forest, stop: (row: ProcRow) => boolean): ProcRow[] {
  const out = [root]
  const seen = new Set([root.pid])
  for (let i = 0; i < out.length; i++) {
    for (const c of f.children.get(out[i]!.pid) ?? []) {
      if (seen.has(c.pid) || stop(c)) continue
      seen.add(c.pid)
      out.push(c)
    }
  }
  return out
}

// Claude Code 2.1.294 on Windows: Bash tool = bash.exe right under claude.exe, PowerShell tool = cmd.exe /c chcp & powershell,
// stdio MCP servers = cmd.exe /c "npx …" → node (or node / uvx / bun directly). So cmd.exe is a shell only when it hosts one.
function isToolShell(child: ProcRow, f: Forest): boolean {
  if (baseName(child.name) !== 'cmd') return isShell(child.name)
  return (f.children.get(child.pid) ?? []).some((g) => isShell(g.name) && baseName(g.name) !== 'cmd')
}

function mainOf(members: readonly ProcRow[]): ProcRow {
  return members.find((m) => !isShell(m.name) && !CONSOLE_HOSTS.has(baseName(m.name))) ?? members[0]!
}

function portsOf(members: readonly ProcRow[], ports: ReadonlyMap<number, ResPort[]> | undefined): ResPort[] {
  if (!ports) return []
  return members.flatMap((m) => ports.get(m.pid) ?? [])
}

function entry(root: ProcRow, members: ProcRow[], sessionId: string | null, orphan: boolean, ports: ReadonlyMap<number, ResPort[]> | undefined): ServerEntry {
  const p = portsOf(members, ports)
  const kind: ResKind = p.length ? 'dev-server' : isShell(root.name) ? 'shell' : 'other'
  return { root, main: mainOf(members), members, kind, sessionId, orphan, ports: p }
}

/**
 * Session trees (claude / codex process + descendants, daemons cut out), the shells under them, processes that
 * left a session's tree (orphans once that session is gone) and every daemon / emulator on the machine.
 * MCP servers (non-shell direct children) only count toward the session's RAM.
 */
export function buildTree(input: {
  rows: readonly ProcRow[]
  sessions: readonly SessionRoot[]
  lineage: ReadonlyMap<string, string>
  ports?: ReadonlyMap<number, ResPort[]>
}): TreeResult {
  const f = forest(input.rows)
  const daemons = new Map<number, DaemonInfo>()
  for (const r of input.rows) {
    const d = daemonOf(r.name, r.cmd)
    if (d) daemons.set(r.pid, d)
  }
  const isDaemon = (r: ProcRow) => daemons.has(r.pid)
  const seen = new Map<string, string>()
  const placed = new Set<number>()
  const sessions: SessionTree[] = []
  const servers: ServerEntry[] = []
  const live = new Set<string>()

  for (const s of input.sessions) {
    const root = f.byPid.get(s.pid)
    if (!root || placed.has(root.pid)) continue
    live.add(s.sessionId)
    const members = subtree(root, f, isDaemon)
    for (const m of members) placed.add(m.pid)
    sessions.push({ sessionId: s.sessionId, root, members })
    for (const m of members.slice(1)) {
      const key = procKey(m)
      if (key) seen.set(key, s.sessionId)
    }
    for (const c of f.children.get(root.pid) ?? []) {
      if (!isDaemon(c) && isToolShell(c, f)) servers.push(entry(c, subtree(c, f, isDaemon), s.sessionId, false, input.ports))
    }
    // Daemons right under the tree (gradlew → java) are remembered too, so their row can name the session.
    for (const m of members) {
      for (const c of f.children.get(m.pid) ?? []) {
        const key = isDaemon(c) ? procKey(c) : null
        if (key) seen.set(key, s.sessionId)
      }
    }
  }

  const sessionOf = (r: ProcRow): string | undefined => {
    const key = procKey(r)
    return key ? (input.lineage.get(key) ?? seen.get(key)) : undefined
  }
  const left = input.rows.filter((r) => !placed.has(r.pid) && !isDaemon(r) && sessionOf(r) !== undefined)
  const leftPids = new Set(left.map((r) => r.pid))
  for (const r of left) {
    const p = f.parentOf(r)
    if (p && leftPids.has(p.pid)) continue
    const sessionId = sessionOf(r)!
    const members = subtree(r, f, (c) => isDaemon(c) || placed.has(c.pid))
    for (const m of members) placed.add(m.pid)
    servers.push(entry(r, members, sessionId, !live.has(sessionId), input.ports))
  }

  for (const [pid, daemon] of daemons) {
    const root = f.byPid.get(pid)!
    const p = f.parentOf(root)
    if (p && daemons.get(p.pid)?.type === daemon.type) continue
    const members = subtree(root, f, () => false)
    const ports = daemon.type === 'emulator' ? [] : portsOf(members, input.ports)
    servers.push({ root, main: root, members, kind: daemon.type === 'emulator' ? 'emulator' : 'daemon', sessionId: sessionOf(root) ?? null, orphan: false, ports, daemon })
  }
  return { sessions, servers, seen }
}

export function cpuPercent(prev: { cpuMs: number; at: number } | undefined, cpuMs: number | null, at: number, cores: number): number | null {
  if (!prev || cpuMs === null || at <= prev.at || cores <= 0) return null
  return (Math.max(0, cpuMs - prev.cpuMs) / (at - prev.at) / cores) * 100
}

/** Sum over members; null when the root's own value is unknown (an unreadable root makes the total meaningless). */
export function sumOf(members: readonly ProcRow[], value: (r: ProcRow) => number | null): number | null {
  if (members.length === 0 || value(members[0]!) === null) return null
  let total = 0
  for (const m of members) total += value(m) ?? 0
  return total
}
