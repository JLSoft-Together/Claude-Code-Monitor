import { isMcpRunTool, parseMcpRunResult, type McpRunCall, type McpRunResult } from './mcpRun'
import { isPtyPreset, type PtyPreset } from './pty'

/** v80: MCP tools of the PTY host that need the workspace page (docs §11w). */
export const AGENT_NOTE_LEVELS = ['info', 'attention', 'done'] as const
export type AgentNoteLevel = (typeof AGENT_NOTE_LEVELS)[number]
export const AGENT_NOTE_MAX = 200

export const isAgentNoteLevel = (v: unknown): v is AgentNoteLevel => (AGENT_NOTE_LEVELS as readonly unknown[]).includes(v)

/** One line, no control / bidi override characters (a toast must not be able to fake its own sender). */
export function cleanNoteText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const text = v
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/[\u2028\u2029]+/g, ' ')
    .replace(/[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]|[\u{e0000}-\u{e007f}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text ? [...text].slice(0, AGENT_NOTE_MAX).join('') : null
}

export type McpPageCall =
  | { id: string; tool: 'notify_owner'; from: string; cwd: string; text: string; level: AgentNoteLevel; merged: number }
  | { id: string; tool: 'open_in_workspace'; from: string; cwd: string; path: string; line?: number; diff: boolean }
  | { id: string; tool: 'who_is_editing'; from: string; cwd: string; path: string }
  | McpRunCall

export type McpPageTool = McpPageCall['tool']

export interface FileEditor {
  /** Alias the owner set, else the folder name: never the auto title summarised from another session's chat. */
  name: string
  agent: PtyPreset
  status?: string
  branch: string | null
  /** Checkout (worktree) root the other session works in. */
  root: string
  /** Same working tree as the caller: the change is there, but which session made it cannot be told. */
  sameCheckout: boolean
  /** The file in that checkout, absolute. */
  file: string
  lastActivityAt?: string
  /** Epoch ms of the file's last write in that checkout, filled in by the PTY host. */
  modifiedAt?: number
}

export type McpPageError = 'unavailable' | 'caller' | 'failed' | 'limit'

export type McpPageResult =
  | { ok: true; tool: 'notify_owner'; name: string; terminalId?: string; inbox: boolean }
  | { ok: true; tool: 'open_in_workspace'; paneKey: string; reused: boolean }
  | { ok: true; tool: 'who_is_editing'; repo: boolean; editors: FileEditor[] }
  | McpRunResult
  | { ok: false; error: McpPageError }

const ERRORS: readonly McpPageError[] = ['unavailable', 'caller', 'failed', 'limit']
const REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._\/-]{1,255}$/
const STATUS = /^[a-z]{1,20}$/
const EDITORS_MAX = 16
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function parseEditor(v: unknown): FileEditor | null {
  if (!isObj(v)) return null
  const name = cleanNoteText(str(v.name, 400))?.slice(0, 80)
  const root = str(v.root, 4096)
  const file = str(v.file, 4096)
  if (!name || !root || !file || /[\0\r\n]/.test(root + file) || !isPtyPreset(v.agent)) return null
  const status = str(v.status, 20)
  const branch = str(v.branch, 255)
  const at = str(v.lastActivityAt, 40)
  return {
    name,
    agent: v.agent,
    ...(status && STATUS.test(status) ? { status } : {}),
    branch: branch && REF.test(branch) ? branch : null,
    root,
    sameCheckout: v.sameCheckout === true,
    file,
    ...(at ? { lastActivityAt: at } : {}),
  }
}

/** The page's answer is checked like any other input before it reaches an agent. */
export function parseMcpPageResult(raw: unknown, tool: McpPageTool): McpPageResult {
  if (!isObj(raw)) return { ok: false, error: 'failed' }
  if (raw.ok !== true) return { ok: false, error: ERRORS.includes(raw.error as McpPageError) ? (raw.error as McpPageError) : 'failed' }
  if (isMcpRunTool(tool)) return parseMcpRunResult(raw, tool) ?? { ok: false, error: 'failed' }
  if (tool === 'notify_owner') {
    const name = str(raw.name, 120)
    const terminalId = str(raw.terminalId, 200)
    return name ? { ok: true, tool, name, ...(terminalId ? { terminalId } : {}), inbox: raw.inbox === true } : { ok: false, error: 'failed' }
  }
  if (tool === 'open_in_workspace') {
    const paneKey = str(raw.paneKey, 100)
    return paneKey ? { ok: true, tool, paneKey, reused: raw.reused === true } : { ok: false, error: 'failed' }
  }
  const editors = Array.isArray(raw.editors) ? raw.editors.slice(0, EDITORS_MAX).map(parseEditor).filter((e): e is FileEditor => !!e) : []
  return { ok: true, tool, repo: raw.repo === true, editors }
}

/** Desktop main → collector: toast / phone for an agent's note; quiet hours and toast kinds are applied there. */
export interface AgentNoteMessage {
  type: 'agent.note'
  episode: string
  level: AgentNoteLevel
  text: string
  /** Shown name when the collector has no session for `terminalId`. */
  name: string
  terminalId?: string
  /** Notes folded into this one by the per-pane rate limit. */
  merged: number
}

export function parseAgentNote(raw: unknown): AgentNoteMessage | null {
  if (!isObj(raw) || raw.type !== 'agent.note') return null
  const episode = str(raw.episode, 200)
  const text = cleanNoteText(raw.text)
  const name = cleanNoteText(raw.name)
  if (!episode || !text || !name || !isAgentNoteLevel(raw.level)) return null
  const terminalId = str(raw.terminalId, 200)
  const merged = typeof raw.merged === 'number' && Number.isInteger(raw.merged) && raw.merged > 0 && raw.merged < 10_000 ? raw.merged : 0
  return { type: 'agent.note', episode, level: raw.level, text, name: name.slice(0, 80), ...(terminalId ? { terminalId } : {}), merged }
}
