import { AGENT_NOTE_MAX, cleanNoteText, isAgentNoteLevel, type AgentNoteLevel } from '../../../../../packages/shared/src/mcpCall'
import { toolResult, type McpTool, type NoteOutcome, type ToolDef } from './types'

export const NOTE_RATE_MAX = 6
export const NOTE_RATE_MS = 60_000

export const NOTIFY_OWNER_TOOL = {
  name: 'notify_owner',
  description:
    "Tell the user something without waiting for them: the note goes to Orrery's Inbox with this session's name, and as a desktop notification (and to their phone if they enabled it) for level attention, or done if they turned on done notifications, subject to their quiet hours. Use it sparingly, when a long task finished or something needs a human decision. It never reaches another agent.",
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1, maxLength: AGENT_NOTE_MAX, description: 'One short line for the user, at most 200 characters. No secrets: it may be shown on a phone.' },
      level: { type: 'string', enum: ['info', 'attention', 'done'], default: 'info', description: 'info: Inbox only. attention: needs the user. done: a task finished.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  annotations: { title: 'Notify the Orrery user', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
} satisfies ToolDef

const RANK: Record<AgentNoteLevel, number> = { info: 0, done: 1, attention: 2 }

/**
 * At most NOTE_RATE_MAX notes a minute per pane reach the user; the rest fold into one note (last text, most
 * urgent level, "+N more") sent as soon as the window has room, so a chatty agent cannot flood the toasts.
 */
export class NoteQueue {
  private sent: number[] = []
  private pending: { text: string; level: AgentNoteLevel; count: number } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly send: (text: string, level: AgentNoteLevel, merged: number) => Promise<NoteOutcome>,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(at: number): void {
    this.sent = this.sent.filter((t) => at - t < NOTE_RATE_MS)
  }

  submit(text: string, level: AgentNoteLevel): Promise<NoteOutcome> {
    const at = this.now()
    this.prune(at)
    if (this.sent.length < NOTE_RATE_MAX && !this.pending) {
      this.sent.push(at)
      return this.send(text, level, 0)
    }
    const p = this.pending
    this.pending = { text, level: p && RANK[p.level] > RANK[level] ? p.level : level, count: (p?.count ?? 0) + 1 }
    const inMs = Math.max(0, (this.sent[0] ?? at) + NOTE_RATE_MS - at)
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), inMs)
      this.timer.unref?.()
    }
    return Promise.resolve({ ok: true, sent: false, inMs })
  }

  flush(): void {
    this.timer = null
    const p = this.pending
    if (!p) return
    const at = this.now()
    this.prune(at)
    if (this.sent.length >= NOTE_RATE_MAX) {
      this.timer = setTimeout(() => this.flush(), Math.max(0, this.sent[0]! + NOTE_RATE_MS - at))
      this.timer.unref?.()
      return
    }
    this.pending = null
    this.sent.push(at)
    void this.send(p.text, p.level, p.count - 1).catch(() => undefined)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }
}

export type NoteArgs = { ok: true; text: string; level: AgentNoteLevel } | { ok: false; error: 'text' | 'level' }

export function parseNoteArgs(args: Record<string, unknown>): NoteArgs {
  const level = args.level === undefined || args.level === null ? 'info' : args.level
  if (!isAgentNoteLevel(level)) return { ok: false, error: 'level' }
  if (typeof args.text !== 'string' || [...args.text].length > AGENT_NOTE_MAX) return { ok: false, error: 'text' }
  const text = cleanNoteText(args.text)
  return text ? { ok: true, text, level } : { ok: false, error: 'text' }
}

const ERRORS = {
  text: 'text must be one non-empty line of at most 200 characters.',
  level: 'level must be info, attention or done.',
  unavailable: 'Orrery is not ready to show notes right now.',
  failed: 'Orrery could not deliver the note.',
} as const

export const notifyOwner: McpTool = {
  def: NOTIFY_OWNER_TOOL,
  async call(args, host) {
    const parsed = parseNoteArgs(args)
    if (!parsed.ok) return toolResult(ERRORS[parsed.error], parsed, true)
    let out: NoteOutcome
    try {
      out = await host.notify(parsed.text, parsed.level)
    } catch {
      out = { ok: false, error: 'failed' }
    }
    if (!out.ok) return toolResult(ERRORS[out.error], out, true)
    if (!out.sent)
      return toolResult(`More than ${NOTE_RATE_MAX} notes a minute from this session: this one is held and shown together with the others in about ${Math.ceil(out.inMs / 1000)} s.`, out)
    return toolResult(out.inbox ? `Note shown to the user in Orrery's Inbox as ${out.name}.` : `Note delivered to the user as ${out.name}.`, out)
  },
}
