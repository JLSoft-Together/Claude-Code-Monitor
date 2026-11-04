/** v80 WP-5: MCP tools of the PTY host answered by the desktop main process itself (layout daemon, resources, native confirm). */
export const LAYOUT_DEVICES = ['phone', 'tablet'] as const
export type AgentLayoutDevice = (typeof LAYOUT_DEVICES)[number]

interface DeskBase {
  id: string
  /** Calling pane (PTY session id). */
  from: string
  /** The pane's starting folder: the project every argument is checked against. */
  cwd: string
  /** Shell process of the pane (root of its process tree); null when it exited. */
  pid: number | null
  /** Folder name of the pane, only for the native confirm. */
  name: string
}

export type McpDeskCall =
  | (DeskBase & { tool: 'preview_layout'; path: string; device: AgentLayoutDevice; night: boolean })
  | (DeskBase & { tool: 'list_servers' })
  | (DeskBase & { tool: 'free_port'; port: number })
  | (DeskBase & { tool: 'telegram_notify'; state: 'on' | 'off' | 'status' })
  | (DeskBase & { tool: 'telegram_send'; text: string; file?: string })
  | (DeskBase & { tool: 'telegram_receive'; state: 'on' | 'off' | 'status' })

export type McpDeskTool = McpDeskCall['tool']

export const DESK_ERRORS = [
  'unavailable',
  'failed',
  'starting',
  'not-layout',
  'missing',
  'too-large',
  'jar-missing',
  'bundle-missing',
  'jdk-missing',
  'jdk-old',
  'crash-loop',
  'render-failed',
  'timeout',
  'no-report',
  'not-found',
  'not-mine',
  'outside',
  'emulator',
  'self',
  'busy',
  'gone',
  'cancelled',
  'confirm-open',
  'telegram-off',
  'telegram-config',
  'no-topic',
  'not-paired',
  'rate',
] as const
export type McpDeskError = (typeof DESK_ERRORS)[number]

export interface AgentLayoutDiagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  line?: number
}

export interface AgentServer {
  pid: number
  name: string
  kind: string
  ports: number[]
  /** Started from this pane's process tree, its agent session, or with a working folder inside its project: free_port may stop it. */
  mine: boolean
  /** Masked command line, only for `mine`. */
  cmd?: string
  /** Seconds since it went idle (no CPU, no connection); null while busy. */
  idleSec: number | null
  /** Its session has ended. */
  orphan: boolean
}

export type McpDeskResult =
  | { ok: true; tool: 'preview_layout'; png: string; width: number; height: number; renderMs: number; frameworkOnly: boolean; diagnostics: AgentLayoutDiagnostic[] }
  | { ok: true; tool: 'list_servers'; at: string; servers: AgentServer[]; outside: { port: number; name: string }[] }
  | { ok: true; tool: 'free_port'; port: number; stopped: { pid: number; name: string }[] }
  | { ok: true; tool: 'telegram_notify'; enabled: boolean; configured: boolean; projects: string[]; routed: boolean }
  | { ok: true; tool: 'telegram_send'; topic: string; file?: string; linkOnly?: boolean }
  | { ok: true; tool: 'telegram_receive'; receiving: boolean; paired: boolean; owner?: string }
  | { ok: false; error: McpDeskError; retryInSec?: number; detail?: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined)
const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined)
// Names and messages go to an agent as text: one line, no control characters.
const line = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}
export const DIAG_MAX = 12
const SERVERS_MAX = 100

function parseServer(v: unknown): AgentServer | null {
  if (!isObj(v)) return null
  const pid = int(v.pid, 1, 0x7fffffff)
  const name = line(v.name, 120)
  const kind = str(v.kind, 20)
  if (!pid || !name || !kind || !/^[a-z-]+$/.test(kind) || !Array.isArray(v.ports)) return null
  const ports = v.ports.slice(0, 32).filter((p): p is number => int(p, 1, 65535) !== undefined)
  const cmd = v.mine === true ? line(v.cmd, 200) : undefined
  const idleSec = v.idleSec === null ? null : (int(v.idleSec, 0, 10 * 365 * 86400) ?? null)
  return { pid, name, kind, ports, mine: v.mine === true, ...(cmd ? { cmd } : {}), idleSec, orphan: v.orphan === true }
}

/** The main process's answer is checked again by the PTY host before it reaches an agent. */
export function parseMcpDeskResult(raw: unknown, tool: McpDeskTool): McpDeskResult {
  if (!isObj(raw)) return { ok: false, error: 'failed' }
  if (raw.ok !== true) {
    const error = (DESK_ERRORS as readonly unknown[]).includes(raw.error) ? (raw.error as McpDeskError) : 'failed'
    const retryInSec = int(raw.retryInSec, 1, 600)
    const detail = line(raw.detail, 300)
    return { ok: false, error, ...(retryInSec ? { retryInSec } : {}), ...(detail ? { detail } : {}) }
  }
  if (tool === 'preview_layout') {
    const png = str(raw.png, 4096)
    const width = int(raw.width, 1, 16384)
    const height = int(raw.height, 1, 16384)
    if (!png || /[\0\r\n]/.test(png) || !/\.png$/i.test(png) || !width || !height) return { ok: false, error: 'failed' }
    const diagnostics = (Array.isArray(raw.diagnostics) ? raw.diagnostics : []).slice(0, DIAG_MAX).flatMap((d): AgentLayoutDiagnostic[] => {
      if (!isObj(d)) return []
      const message = line(d.message, 300)
      if (!message) return []
      const severity = d.severity === 'error' || d.severity === 'warning' ? d.severity : 'info'
      const at = int(d.line, 1, 10_000_000)
      return [{ severity, message, ...(at ? { line: at } : {}) }]
    })
    return { ok: true, tool, png, width, height, renderMs: int(raw.renderMs, 0, 600_000) ?? 0, frameworkOnly: raw.frameworkOnly === true, diagnostics }
  }
  if (tool === 'list_servers') {
    const servers = (Array.isArray(raw.servers) ? raw.servers : []).slice(0, SERVERS_MAX).map(parseServer).filter((s): s is AgentServer => !!s)
    const outside = (Array.isArray(raw.outside) ? raw.outside : []).slice(0, SERVERS_MAX).flatMap((o): { port: number; name: string }[] => {
      if (!isObj(o)) return []
      const port = int(o.port, 1, 65535)
      const name = line(o.name, 120)
      return port && name ? [{ port, name }] : []
    })
    return { ok: true, tool, at: str(raw.at, 40) ?? '', servers, outside }
  }
  if (tool === 'telegram_notify') {
    const projects = (Array.isArray(raw.projects) ? raw.projects : []).slice(0, 100).flatMap((p): string[] => {
      const s = line(p, 120)
      return s ? [s] : []
    })
    return { ok: true, tool, enabled: raw.enabled === true, configured: raw.configured === true, projects, routed: raw.routed === true }
  }
  if (tool === 'telegram_receive') {
    const owner = line(raw.owner, 80)
    return { ok: true, tool, receiving: raw.receiving === true, paired: raw.paired === true, ...(owner ? { owner } : {}) }
  }
  if (tool === 'telegram_send') {
    const topic = line(raw.topic, 120)
    if (!topic) return { ok: false, error: 'failed' }
    const file = line(raw.file, 200)
    return { ok: true, tool, topic, ...(file ? { file } : {}), ...(raw.linkOnly === true ? { linkOnly: true } : {}) }
  }
  const port = int(raw.port, 1, 65535)
  if (!port || !Array.isArray(raw.stopped)) return { ok: false, error: 'failed' }
  const stopped = raw.stopped.slice(0, 50).flatMap((s): { pid: number; name: string }[] => {
    if (!isObj(s)) return []
    const pid = int(s.pid, 1, 0x7fffffff)
    const name = line(s.name, 120)
    return pid && name ? [{ pid, name }] : []
  })
  return { ok: true, tool, port, stopped }
}
