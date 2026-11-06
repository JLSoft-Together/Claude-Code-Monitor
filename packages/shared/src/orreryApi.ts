import { cleanNoteText, isAgentNoteLevel, type McpPageCall, type McpPageTool } from './mcpCall'
import { LAYOUT_DEVICES, type AgentLayoutDevice, type McpDeskCall, type McpDeskTool } from './mcpDesk'
import { isMcpRunAction, isMcpRunId, MCP_LOG_LINES_DEFAULT, MCP_LOG_LINES_MAX } from './mcpRun'
import { cleanPanePrompt, isAgentSessionId, isPtyPreset, PANE_OPEN_PROMPT_MAX, type PaneOpenError, type PaneOpenRequest, type PtyPreset } from './pty'
import { parseInbound, type TelegramInbound } from './telegram'

/** Who asked for a session to be opened; decides prompt submit, the live-pane limit and docking (OPEN_POLICY). */
export type OrrerySource = 'menu' | 'palette' | 'mcp' | 'url' | 'telegram' | 'restore'

export interface SessionOpenInput {
  preset: PtyPreset
  /** Required from mcp / url / telegram; in-app callers may leave it out (home folder). */
  cwd?: string
  resume?: string
  prompt?: string
  submit?: boolean
  name?: string
  /** PTY host session id of the calling pane (MCP `open_session`). */
  from?: string
  /** Host open ticket: the host already minted the session id and name for it. */
  id?: string
  tab?: boolean
}

export type SessionOpenError = PaneOpenError

export type SessionOpenResult = { ok: true; paneKey: string } | { ok: false; error: SessionOpenError }

export interface OpenPolicy {
  /** A prompt is submitted, not only typed into the input line (owner exception, docs §11an). */
  submit: boolean
  /** Refused with `limit` once PANE_LIVE_MAX term panes are running or starting. */
  limit: boolean
  /** Split beside the calling pane without taking focus. */
  dock: boolean
}

export const OPEN_POLICY: Readonly<Record<OrrerySource, OpenPolicy>> = {
  menu: { submit: false, limit: false, dock: false },
  palette: { submit: false, limit: false, dock: false },
  restore: { submit: false, limit: false, dock: false },
  mcp: { submit: false, limit: true, dock: true },
  url: { submit: false, limit: true, dock: false },
  telegram: { submit: true, limit: true, dock: false },
}

/** Same as the PTY host's live-session cap. */
export const PANE_LIVE_MAX = 16

/** Which agent pane of a project a pane action is for; without terminalId / sessionId it must be the only one. */
export interface SessionTarget {
  project: string
  /** Sub-projects with a topic of their own: their panes are left out. */
  nested?: string[]
  terminalId?: string
  /** PTY host session id of the pane. */
  sessionId?: string
  /** Workspace pane key (in-app callers). */
  pane?: string
}

export type SessionAction = 'session.status' | 'session.send' | 'session.keys' | 'session.stop' | 'session.tail'

/** none / many / gone: no pane, no single pane, or the targeted pane is closed; busy: a prompt or key press is pending; state: the agent is not where the key applies. */
export const SESSION_ACT_ERRORS = ['none', 'many', 'gone', 'busy', 'state', 'unavailable'] as const
export type SessionActError = (typeof SESSION_ACT_ERRORS)[number]

/** Where an action runs: the workspace page (needs its state), main's desk tools, or main itself. */
export type OrreryRuns = 'page' | 'desk' | 'main'

/** Who calls; `pane` is the PTY host session id of the calling pane, already checked against its token by the host. */
export interface OrreryCaller {
  source: OrrerySource
  pane?: string
}

export const ORRERY_ERRORS = ['unknown', 'source', 'args', 'unavailable', 'failed'] as const
export type OrreryError = (typeof ORRERY_ERRORS)[number]
export type OrreryFailure = { ok: false; error: OrreryError }
/** What a handler answers: the action's own result shape, or a failure the caller's adapter maps. */
export type OrreryResult = unknown

export interface OrrerySpec<T> {
  runs: OrreryRuns
  sources: readonly OrrerySource[]
  /** Typed copy of the arguments, or null: nothing unchecked reaches a handler. */
  parse: (args: unknown) => T | null
}

const ID_MAX = 100
const PANE_ID_MAX = 200
const PATH_MAX = 4096
const TEXT_MAX = 20_000

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !v.includes('\0')
const filled = (v: unknown, max: number): v is string => text(v, max) && v.length > 0
const pathArg = (v: unknown): v is string => filled(v, PATH_MAX) && !/[\r\n]/.test(v)
const opt = <K extends string, V>(key: K, v: V | undefined): { [P in K]?: V } => (v === undefined ? {} : ({ [key]: v } as { [P in K]?: V }))

export const isOrrerySource = (v: unknown): v is OrrerySource => typeof v === 'string' && Object.hasOwn(OPEN_POLICY, v)

export function parseOrreryCaller(raw: unknown): OrreryCaller | null {
  if (!isObj(raw) || !isOrrerySource(raw.source)) return null
  if (raw.pane === undefined) return { source: raw.source }
  return filled(raw.pane, PANE_ID_MAX) ? { source: raw.source, pane: raw.pane } : null
}

function parsePaneOpen(raw: unknown): PaneOpenRequest | null {
  if (!isObj(raw) || !filled(raw.id, ID_MAX) || !isPtyPreset(raw.preset) || !pathArg(raw.cwd)) return null
  if (raw.from !== undefined && !filled(raw.from, PANE_ID_MAX)) return null
  if (raw.resume !== undefined && !isAgentSessionId(raw.resume)) return null
  if (raw.prompt !== undefined && !text(raw.prompt, PANE_OPEN_PROMPT_MAX * 2)) return null
  const prompt = cleanPanePrompt(raw.prompt)
  return { id: raw.id, preset: raw.preset, cwd: raw.cwd, ...opt('from', raw.from as string | undefined), ...opt('prompt', prompt), ...opt('resume', raw.resume as string | undefined) }
}

type PageCall<T extends McpPageTool> = Extract<McpPageCall, { tool: T }>

/** v80 MCP calls of the PTY host that need the page; field checks only, the host already resolved paths. */
export function parseMcpPageCall<T extends McpPageTool>(raw: unknown, tool: T): PageCall<T> | null {
  if (!isObj(raw) || raw.tool !== tool || !filled(raw.id, ID_MAX) || !filled(raw.from, PANE_ID_MAX) || !pathArg(raw.cwd)) return null
  const base = { id: raw.id, from: raw.from, cwd: raw.cwd }
  const call = ((): McpPageCall | null => {
    switch (raw.tool as McpPageTool) {
      case 'notify_owner': {
        const note = cleanNoteText(raw.text)
        const merged = typeof raw.merged === 'number' && Number.isInteger(raw.merged) && raw.merged >= 0 && raw.merged < 10_000 ? raw.merged : 0
        return note && isAgentNoteLevel(raw.level) ? { ...base, tool: 'notify_owner', text: note, level: raw.level, merged } : null
      }
      case 'open_in_workspace': {
        if (!pathArg(raw.path)) return null
        const line = typeof raw.line === 'number' && Number.isInteger(raw.line) && raw.line > 0 ? raw.line : undefined
        return { ...base, tool: 'open_in_workspace', path: raw.path, ...opt('line', line), diff: raw.diff === true }
      }
      case 'who_is_editing':
        return pathArg(raw.path) ? { ...base, tool: 'who_is_editing', path: raw.path } : null
      case 'hand_back':
        return pathArg(raw.report) && filled(raw.summary, TEXT_MAX) ? { ...base, tool: 'hand_back', report: raw.report, summary: raw.summary } : null
      case 'list_sessions':
        return { ...base, tool: 'list_sessions' }
      case 'send_to_session': {
        if (!filled(raw.session, PANE_ID_MAX) || !text(raw.text, PANE_OPEN_PROMPT_MAX * 2)) return null
        const body = cleanPanePrompt(raw.text)
        return body ? { ...base, tool: 'send_to_session', session: raw.session, text: body } : null
      }
      case 'close_session':
        return filled(raw.session, PANE_ID_MAX) ? { ...base, tool: 'close_session', session: raw.session } : null
      case 'run_app': {
        if (!isMcpRunAction(raw.action)) return null
        const id = (v: unknown): string | undefined | null => (v === undefined ? undefined : isMcpRunId(v) ? v : null)
        const config = id(raw.config)
        const device = id(raw.device)
        if (config === null || device === null) return null
        return { ...base, tool: 'run_app', action: raw.action, ...opt('config', config), ...opt('device', device), ...(raw.full === true ? { full: true } : {}) }
      }
      case 'run_status':
        return { ...base, tool: 'run_status' }
      case 'run_log': {
        const lines = typeof raw.lines === 'number' && Number.isInteger(raw.lines) ? Math.min(MCP_LOG_LINES_MAX, Math.max(1, raw.lines)) : MCP_LOG_LINES_DEFAULT
        return { ...base, tool: 'run_log', lines, errorsOnly: raw.errorsOnly === true }
      }
      case 'device_screenshot': {
        if (raw.serial !== undefined && !isMcpRunId(raw.serial)) return null
        return { ...base, tool: 'device_screenshot', ...opt('serial', raw.serial as string | undefined) }
      }
      default:
        return null
    }
  })()
  return call as PageCall<T> | null
}

type DeskCall<T extends McpDeskTool> = Extract<McpDeskCall, { tool: T }>
const TELEGRAM_STATES = ['on', 'off', 'status'] as const
const isTelegramState = (v: unknown): v is (typeof TELEGRAM_STATES)[number] => (TELEGRAM_STATES as readonly unknown[]).includes(v)

/** v80 WP-5 tools main answers itself; the PTY host builds them from a checked pane. */
export function parseMcpDeskCall<T extends McpDeskTool>(raw: unknown, tool: T): DeskCall<T> | null {
  if (!isObj(raw) || raw.tool !== tool || !filled(raw.id, ID_MAX) || !filled(raw.from, PANE_ID_MAX) || !pathArg(raw.cwd) || !text(raw.name, PATH_MAX)) return null
  const pid = raw.pid === null ? null : typeof raw.pid === 'number' && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : undefined
  if (pid === undefined) return null
  const base = { id: raw.id, from: raw.from, cwd: raw.cwd, pid, name: raw.name }
  const call = ((): McpDeskCall | null => {
    switch (raw.tool as McpDeskTool) {
      case 'preview_layout':
        return pathArg(raw.path) && (LAYOUT_DEVICES as readonly unknown[]).includes(raw.device)
          ? { ...base, tool: 'preview_layout', path: raw.path, device: raw.device as AgentLayoutDevice, night: raw.night === true }
          : null
      case 'list_servers':
        return { ...base, tool: 'list_servers' }
      case 'free_port':
        return typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65_536 ? { ...base, tool: 'free_port', port: raw.port } : null
      case 'telegram_notify':
      case 'telegram_receive':
        return isTelegramState(raw.state) ? { ...base, tool: raw.tool as 'telegram_notify' | 'telegram_receive', state: raw.state } : null
      case 'telegram_send':
        if (!text(raw.text, TEXT_MAX) || (raw.file !== undefined && !pathArg(raw.file))) return null
        return { ...base, tool: 'telegram_send', text: raw.text, ...opt('file', raw.file as string | undefined) }
      default:
        return null
    }
  })()
  return call as DeskCall<T> | null
}

type Inbound<A extends TelegramInbound['action']> = Extract<TelegramInbound, { action: A }>
const inbound =
  <A extends TelegramInbound['action']>(action: A) =>
  (raw: unknown): Inbound<A> | null => {
    const req = parseInbound(raw)
    return req?.action === action ? (req as Inbound<A>) : null
  }

const spec = <R extends OrreryRuns, T>(runs: R, sources: readonly OrrerySource[], parse: (args: unknown) => T | null): OrrerySpec<T> & { runs: R } => ({ runs, sources, parse })
const onPage = <T extends McpPageTool>(tool: T) => spec('page', ['mcp'], (a) => parseMcpPageCall(a, tool))
const onDesk = <T extends McpDeskTool>(tool: T) => spec('desk', ['mcp'], (a) => parseMcpDeskCall(a, tool))
const fromBot = <A extends TelegramInbound['action']>(action: A) => spec('page', ['telegram'], inbound(action))

/**
 * Everything callers outside the page may ask of the workspace. Main's dispatcher and the page's executor both
 * check the source and parse the arguments with this one table. The host offers hand_back only in a DeepSeek pane
 * another agent opened; free_port and turning telegram_receive on still ask the owner in main's desk.
 */
export const ORRERY_ACTIONS = {
  'session.open': spec('page', ['mcp', 'url'], parsePaneOpen),
  'session.status': fromBot('status'),
  'session.send': fromBot('send'),
  'session.sendAll': fromBot('all'),
  'session.keys': fromBot('keys'),
  'session.tail': fromBot('tail'),
  'session.compact': fromBot('compact'),
  'session.closeOwner': fromBot('close'),
  'session.focus': fromBot('focus'),
  'session.create': fromBot('new'),
  'session.resumeList': fromBot('resumeList'),
  'session.resume': fromBot('resume'),
  'session.handBack': onPage('hand_back'),
  'session.list': onPage('list_sessions'),
  'session.sendTo': onPage('send_to_session'),
  'session.close': onPage('close_session'),
  'owner.notify': onPage('notify_owner'),
  'workspace.show': onPage('open_in_workspace'),
  'file.editors': onPage('who_is_editing'),
  'run.app': onPage('run_app'),
  'run.status': onPage('run_status'),
  'run.log': onPage('run_log'),
  'device.screenshot': spec('main', ['mcp'], (a) => parseMcpPageCall(a, 'device_screenshot')),
  'layout.preview': onDesk('preview_layout'),
  'port.list': onDesk('list_servers'),
  'port.free': onDesk('free_port'),
  'telegram.notify': onDesk('telegram_notify'),
  'telegram.send': onDesk('telegram_send'),
  'telegram.receive': onDesk('telegram_receive'),
} as const

export type OrreryAction = keyof typeof ORRERY_ACTIONS
export type OrreryArgs<A extends OrreryAction> = (typeof ORRERY_ACTIONS)[A] extends OrrerySpec<infer T> ? T : never
export type OrreryActionOn<R extends OrreryRuns> = { [A in OrreryAction]: (typeof ORRERY_ACTIONS)[A]['runs'] extends R ? A : never }[OrreryAction]

export const isOrreryAction = (v: unknown): v is OrreryAction => typeof v === 'string' && Object.hasOwn(ORRERY_ACTIONS, v)

/** main → page over `ccm:orrery`; the page answers on `ccm:orrery-reply` with the same id. */
export interface OrreryRequest {
  id: string
  action: OrreryAction
  args: unknown
  caller: OrreryCaller
}

/** The PTY host names MCP tools; the dispatcher names actions. */
export const MCP_TOOL_ACTION: Readonly<Record<McpPageTool | McpDeskTool, OrreryAction>> = {
  notify_owner: 'owner.notify',
  open_in_workspace: 'workspace.show',
  who_is_editing: 'file.editors',
  hand_back: 'session.handBack',
  list_sessions: 'session.list',
  send_to_session: 'session.sendTo',
  close_session: 'session.close',
  run_app: 'run.app',
  run_status: 'run.status',
  run_log: 'run.log',
  device_screenshot: 'device.screenshot',
  preview_layout: 'layout.preview',
  list_servers: 'port.list',
  free_port: 'port.free',
  telegram_notify: 'telegram.notify',
  telegram_send: 'telegram.send',
  telegram_receive: 'telegram.receive',
}

export const TELEGRAM_INBOUND_ACTION: Readonly<Record<TelegramInbound['action'], OrreryAction>> = {
  status: 'session.status',
  send: 'session.send',
  all: 'session.sendAll',
  keys: 'session.keys',
  tail: 'session.tail',
  compact: 'session.compact',
  close: 'session.closeOwner',
  focus: 'session.focus',
  new: 'session.create',
  resumeList: 'session.resumeList',
  resume: 'session.resume',
}
