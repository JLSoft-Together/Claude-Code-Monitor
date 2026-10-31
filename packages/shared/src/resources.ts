/** What a process under (or left by) an agent is, from its name, command line and listening ports. */
export type ResKind = 'shell' | 'dev-server' | 'daemon' | 'emulator' | 'other'

export type DaemonType = 'gradle' | 'kotlin' | 'dart' | 'flutter' | 'emulator'

export interface DaemonInfo {
  type: DaemonType
  /** Gradle / Kotlin version read from the command line or classpath. */
  version?: string
  /** Folder holding `bin/java` (`jbr`, `jdk-17.0.12`…). */
  jdk?: string
  /** Emulator: AVD from `-avd <name>`, adb serial from `-port <n>` when given. */
  avd?: string
  serial?: string
}

/** One LISTEN socket of a process; `established` counts connections to that local port (filled by the port table, R2). */
export interface ResPort {
  port: number
  address: string
  established: number
}

export interface SessionRes {
  /** `TerminalSession.id`. */
  sessionId: string
  pid: number
  /** Creation time of the session process (as `ServerRes.start`); kill requests echo it. */
  start?: string
  /** Process name (`claude.exe`, `node`, `codex`…). */
  name?: string
  /** Working set (Windows) / RSS (macOS, Linux) of the session process and its descendants, daemons excluded. */
  ramBytes: number | null
  /** Share of all cores, 0–100. */
  cpuPct: number | null
  /** Epoch ms since the session sits idle / waiting with nothing running; null while busy. */
  idleSinceMs: number | null
  /** Idle for at least the configured idle minutes. */
  forgotten: boolean
}

export interface ServerRes {
  pid: number
  /** Creation time as the collector read it (FILETIME decimal or ps `lstart`); kill requests must echo it. */
  start: string
  kind: ResKind
  name: string
  /** Command line of the main process, secrets masked, at most 200 chars. */
  cmd: string
  cwd?: string
  ports: ResPort[]
  ramBytes: number | null
  cpuPct: number | null
  idleSinceMs: number | null
  /** Last sample with CPU ≥ 1 % or an open connection (epoch ms); null when never seen busy. */
  lastBusyAt: number | null
  forgotten: boolean
  /** Session the process ran under (for daemons: under which it was first seen). */
  sessionId: string | null
  /** Was a descendant of a session that has ended since. Known only for processes seen while the app ran. */
  orphan: boolean
  daemon?: DaemonInfo
}

export interface ResourceTotals {
  ramBytes: number
  cpuPct: number
  forgotten: number
  forgottenRamBytes: number
}

/** LISTEN sockets of a process outside every agent tree ("outside agent": open / copy only, never stopped from Orrery). */
export interface OutsidePort {
  pid: number
  name: string
  ports: ResPort[]
}

/** A session's tool call failed with "port already in use" (R2); `holder` = who listens on it now, when known. */
export interface PortConflict {
  port: number
  sessionId: string
  /** Epoch ms of the failed tool result. */
  at: number
  holder: { pid: number; name: string; sessionId: string | null } | null
}

export interface ResourceReport {
  at: string
  idleMinutes: number
  cores: number
  sessions: SessionRes[]
  servers: ServerRes[]
  totals: ResourceTotals
  /** Port table (R2); absent when it could not be read. */
  outside?: OutsidePort[]
  conflicts?: PortConflict[]
}

export const RES_SAMPLE_MS = 30_000
/** A port conflict is shown this long after the failed call. */
export const RES_CONFLICT_MS = 15 * 60_000
export const RES_OUTSIDE_MAX = 100
/** Daemons with CPU ≥ 1 % this recently are building: never stopped. */
export const RES_BUSY_GUARD_MS = 2 * 60_000

/** Page → desktop: stop these processes (one native confirm for all). `label` only names a row in the confirm. */
export interface ResKillTarget {
  pid: number
  start: string
  label?: string
}

export type ResKillError = 'invalid' | 'gone' | 'busy' | 'cancelled' | 'failed' | 'unavailable'
export type ResKillResult = { ok: true; killed: number } | { ok: false; error: ResKillError; detail?: string }

const KILL_LABEL_MAX = 120
const START_RE = /^[A-Za-z0-9 :.+-]{1,40}$/
export const RES_KILL_MAX = 50

/** Validates a kill request from the page; null when anything is off. */
export function parseKillTargets(data: unknown): ResKillTarget[] | null {
  if (!Array.isArray(data) || data.length === 0 || data.length > RES_KILL_MAX) return null
  const out: ResKillTarget[] = []
  const seen = new Set<number>()
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) return null
    const t = raw as Record<string, unknown>
    if (typeof t.pid !== 'number' || !Number.isInteger(t.pid) || t.pid <= 4 || t.pid > 0x7fffffff) return null
    if (typeof t.start !== 'string' || !START_RE.test(t.start)) return null
    if (t.label !== undefined && typeof t.label !== 'string') return null
    if (seen.has(t.pid)) continue
    seen.add(t.pid)
    const label = typeof t.label === 'string' ? t.label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, KILL_LABEL_MAX) : ''
    out.push({ pid: t.pid, start: t.start, ...(label ? { label } : {}) })
  }
  return out
}
export const RES_IDLE_CPU_PCT = 1
export const RES_CMD_MAX = 200

/** Desktop → collector (utilityProcess message): Orrery just ran an adb command against this device. */
export interface DeviceUsedMessage {
  type: 'device.used'
  serial: string
  avd?: string
  at: number
}

const SERIAL_RE = /^[A-Za-z0-9._:-]{1,64}$/
const AVD_RE = /^[A-Za-z0-9._-]{1,100}$/

export function parseDeviceUsed(data: unknown): DeviceUsedMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as Record<string, unknown>
  if (m.type !== 'device.used' || typeof m.serial !== 'string' || !SERIAL_RE.test(m.serial)) return null
  if (typeof m.at !== 'number' || !Number.isFinite(m.at) || m.at <= 0) return null
  if (m.avd !== undefined && (typeof m.avd !== 'string' || !AVD_RE.test(m.avd))) return null
  return { type: 'device.used', serial: m.serial, at: m.at, ...(m.avd !== undefined ? { avd: m.avd as string } : {}) }
}
