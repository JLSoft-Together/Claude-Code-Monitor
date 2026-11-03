import type { RunKind, RunState } from './run'

/** v80 WP-4: Run / device MCP tools (docs §11w). The page (run_*) or main (device_screenshot) answers. */
export const MCP_RUN_ACTIONS = ['start', 'reload', 'restart', 'stop'] as const
export type McpRunAction = (typeof MCP_RUN_ACTIONS)[number]
export const isMcpRunAction = (v: unknown): v is McpRunAction => (MCP_RUN_ACTIONS as readonly unknown[]).includes(v)

export const MCP_LOG_LINES_MAX = 200
export const MCP_LOG_LINES_DEFAULT = 50
const LINE_CHARS = 1000
const NAME_CHARS = 80
const DETAIL_CHARS = 300

/** Config ids and device serials: the run IPC's id charset, never an option (leading -). */
const ID = /^(?!-)[A-Za-z0-9_.:@%-]{1,128}$/
export const isMcpRunId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)

export type McpRunPhase = 'starting' | 'running' | 'stopping' | 'crashed' | 'stopped'

export function runPhase(state: RunState): McpRunPhase {
  if (state === 'running' || state === 'reloading') return 'running'
  if (state === 'stopping') return 'stopping'
  if (state === 'failed') return 'crashed'
  if (state === 'stopped' || state === 'cancelled') return 'stopped'
  return 'starting'
}

export interface McpRunConfigInfo {
  id: string
  name: string
  type: RunKind
  /** The config the pane's Run button starts. */
  selected: boolean
  /** Device the config pins; absent = the device picked in the Run bar. */
  device?: string
}

export interface McpRunDeviceInfo {
  serial: string
  name: string
  platform: string
  state: 'ready' | 'unauthorized' | 'offline'
  selected: boolean
}

export interface McpRunSessionInfo {
  id: string
  configId: string
  configName: string
  type: RunKind
  deviceId: string | null
  deviceName: string | null
  state: McpRunPhase
  rawState: RunState
  startedAt: number
  endedAt: number | null
  appId: string | null
  /** One line: failure code / build error / last error log line. */
  lastError: string | null
}

export interface McpRunRefusal {
  code: string
  detail?: string
}

export interface McpLogLine {
  stream: 'build' | 'app' | 'logcat'
  level?: 'V' | 'D' | 'I' | 'W' | 'E' | 'F'
  text: string
}

export interface McpBuildError {
  file: string
  line: number
  col: number
  message: string
  severity: 'error' | 'warning'
}

export interface McpShot {
  path: string
  width: number
  height: number
  serial: string
  name: string
  /** capture = the owner's capture folder (`shots/`); temp = no capture folder set. */
  saved: 'capture' | 'temp'
}

export type McpRunCall =
  | { id: string; tool: 'run_app'; from: string; cwd: string; action: McpRunAction; config?: string; device?: string; full?: boolean }
  | { id: string; tool: 'run_status'; from: string; cwd: string }
  | { id: string; tool: 'run_log'; from: string; cwd: string; lines: number; errorsOnly: boolean }
  | { id: string; tool: 'device_screenshot'; from: string; cwd: string; serial?: string }

export type McpRunTool = McpRunCall['tool']
export const MCP_RUN_TOOLS: readonly McpRunTool[] = ['run_app', 'run_status', 'run_log', 'device_screenshot']
export const isMcpRunTool = (v: unknown): v is McpRunTool => (MCP_RUN_TOOLS as readonly unknown[]).includes(v)

export type McpRunResult =
  | { ok: true; tool: 'run_app'; action: McpRunAction; refused?: McpRunRefusal; session: McpRunSessionInfo | null }
  | { ok: true; tool: 'run_status'; configs: McpRunConfigInfo[]; devices: McpRunDeviceInfo[]; sessions: McpRunSessionInfo[]; focused: string | null }
  | { ok: true; tool: 'run_log'; session: McpRunSessionInfo | null; lines: McpLogLine[]; errors: McpBuildError[]; partial: boolean }
  | { ok: true; tool: 'device_screenshot'; refused?: McpRunRefusal; devices?: { serial: string; name: string }[]; shot?: McpShot }

const KINDS: readonly RunKind[] = ['flutter', 'android', 'custom']
const STATES: readonly RunState[] = ['before-launch', 'building', 'installing', 'launching', 'starting', 'running', 'reloading', 'stopping', 'stopped', 'failed', 'cancelled']
const DEVICE_STATES = ['ready', 'unauthorized', 'offline'] as const
const STREAMS = ['build', 'app', 'logcat'] as const
const LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'] as const
const CODE = /^[a-z0-9][a-z0-9-]{0,39}$/
const PLATFORM = /^[a-z0-9_-]{1,40}$/
const CONFIGS_MAX = 50
const DEVICES_MAX = 30
const SESSIONS_MAX = 10
const ERRORS_MAX = 20

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const oneOf = <T>(list: readonly T[], v: unknown): v is T => list.includes(v as T)
const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
const some = <T>(v: T | null): v is T => v !== null

/** One line of untrusted text: ANSI / control / bidi characters out, capped. Masking happens after, in the host. */
export function cleanRunText(v: unknown, max = LINE_CHARS): string | null {
  if (typeof v !== 'string') return null
  const text = v
    .slice(0, max * 4)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ')
    .replace(/[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]|[\u{e0000}-\u{e007f}]/gu, '')
    .replace(/\t/g, '  ')
    .trimEnd()
  return text ? [...text].slice(0, max).join('') : null
}

const name = (v: unknown): string | null => cleanRunText(v, NAME_CHARS)?.trim() || null

function refusal(v: unknown): McpRunRefusal | undefined {
  if (!isObj(v) || typeof v.code !== 'string' || !CODE.test(v.code)) return undefined
  const detail = cleanRunText(v.detail, DETAIL_CHARS)
  return { code: v.code, ...(detail ? { detail } : {}) }
}

function session(v: unknown): McpRunSessionInfo | null {
  if (!isObj(v) || !isMcpRunId(v.configId) || typeof v.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(v.id)) return null
  if (!oneOf(KINDS, v.type) || !oneOf(STATES, v.rawState)) return null
  const startedAt = time(v.startedAt)
  if (startedAt === null) return null
  const deviceId = isMcpRunId(v.deviceId) ? v.deviceId : null
  const appId = typeof v.appId === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(v.appId) ? v.appId : null
  return {
    id: v.id,
    configId: v.configId,
    configName: name(v.configName) ?? v.configId,
    type: v.type,
    deviceId,
    deviceName: deviceId ? name(v.deviceName) : null,
    state: runPhase(v.rawState),
    rawState: v.rawState,
    startedAt,
    endedAt: time(v.endedAt),
    appId,
    lastError: cleanRunText(v.lastError, DETAIL_CHARS),
  }
}

function config(v: unknown): McpRunConfigInfo | null {
  if (!isObj(v) || !isMcpRunId(v.id) || !oneOf(KINDS, v.type)) return null
  return { id: v.id, name: name(v.name) ?? v.id, type: v.type, selected: v.selected === true, ...(isMcpRunId(v.device) ? { device: v.device } : {}) }
}

function device(v: unknown): McpRunDeviceInfo | null {
  if (!isObj(v) || !isMcpRunId(v.serial) || !oneOf(DEVICE_STATES, v.state)) return null
  const platform = typeof v.platform === 'string' && PLATFORM.test(v.platform) ? v.platform : 'unknown'
  return { serial: v.serial, name: name(v.name) ?? v.serial, platform, state: v.state, selected: v.selected === true }
}

function logLine(v: unknown): McpLogLine | null {
  if (!isObj(v) || !oneOf(STREAMS, v.stream)) return null
  const text = cleanRunText(v.text)
  if (text === null) return null
  return { stream: v.stream, ...(oneOf(LEVELS, v.level) ? { level: v.level } : {}), text }
}

function buildError(v: unknown): McpBuildError | null {
  if (!isObj(v)) return null
  const file = cleanRunText(v.file, 1024)
  const message = cleanRunText(v.message, DETAIL_CHARS)
  const line = time(v.line)
  const col = time(v.col)
  if (!file || !message || line === null || col === null) return null
  return { file, line, col, message, severity: v.severity === 'warning' ? 'warning' : 'error' }
}

function shot(v: unknown): McpShot | null {
  if (!isObj(v) || typeof v.path !== 'string' || v.path.length > 4096 || /[\0\r\n]/.test(v.path) || !/\.png$/i.test(v.path)) return null
  const width = time(v.width)
  const height = time(v.height)
  if (!width || !height || !isMcpRunId(v.serial)) return null
  return { path: v.path, width, height, serial: v.serial, name: name(v.name) ?? v.serial, saved: v.saved === 'capture' ? 'capture' : 'temp' }
}

/** The page's (or main's) answer, checked like any other input before it reaches an agent. */
export function parseMcpRunResult(raw: Record<string, unknown>, tool: McpRunTool): McpRunResult | null {
  if (tool === 'run_app') {
    if (!isMcpRunAction(raw.action)) return null
    const refused = refusal(raw.refused)
    return { ok: true, tool, action: raw.action, ...(refused ? { refused } : {}), session: session(raw.session) }
  }
  if (tool === 'run_status') {
    const focused = typeof raw.focused === 'string' && raw.focused.length <= 64 ? raw.focused : null
    return {
      ok: true,
      tool,
      configs: list(raw.configs, CONFIGS_MAX).map(config).filter(some),
      devices: list(raw.devices, DEVICES_MAX).map(device).filter(some),
      sessions: list(raw.sessions, SESSIONS_MAX).map(session).filter(some),
      focused,
    }
  }
  if (tool === 'run_log') {
    return {
      ok: true,
      tool,
      session: session(raw.session),
      lines: list(raw.lines, MCP_LOG_LINES_MAX).map(logLine).filter(some),
      errors: list(raw.errors, ERRORS_MAX).map(buildError).filter(some),
      partial: raw.partial === true,
    }
  }
  const refused = refusal(raw.refused)
  if (refused) {
    const devices = list(raw.devices, DEVICES_MAX)
      .map((d) => (isObj(d) && isMcpRunId(d.serial) ? { serial: d.serial, name: name(d.name) ?? d.serial } : null))
      .filter(some)
    return { ok: true, tool, refused, ...(devices.length ? { devices } : {}) }
  }
  const s = shot(raw.shot)
  return s ? { ok: true, tool, shot: s } : null
}
