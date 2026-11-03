import type { AgentNoteLevel, McpPageCall, McpPageResult } from '../../../../../packages/shared/src/mcpCall'
import type { McpDeskCall, McpDeskResult } from '../../../../../packages/shared/src/mcpDesk'
import type { PaneOpenError, PtyPreset } from '../../../../../packages/shared/src/pty'

export type Json = Record<string, unknown>

type WithoutCaller<T> = T extends unknown ? Omit<T, 'id' | 'from' | 'cwd'> : never
export type PageAsk = WithoutCaller<Exclude<McpPageCall, { tool: 'notify_owner' }>>

export interface OpenArgs {
  agent?: unknown
  cwd?: unknown
  prompt?: unknown
  name?: unknown
  resume?: unknown
}

export type OpenOutcome = { ok: true; preset: PtyPreset; cwd: string; sessionId?: string; prompt: boolean; resumed?: boolean } | { ok: false; error: PaneOpenError }

export type NoteOutcome = { ok: true; sent: true; name: string; inbox: boolean } | { ok: true; sent: false; inMs: number } | { ok: false; error: 'unavailable' | 'failed' }

/** What a tool may ask of the PTY host, already bound to the calling pane (token checked before). */
export interface ToolHost {
  /** The calling pane's starting folder (real path): every path argument must resolve inside it. */
  root: string
  /** The calling pane's program; absent in hosts that do not know it (tools gated on it then refuse). */
  preset?: PtyPreset
  /** Sliding window per pane and key; false = over the limit. */
  take: (key: string, max: number, windowMs: number) => boolean
  openSession: (args: OpenArgs) => Promise<OpenOutcome>
  notify: (text: string, level: AgentNoteLevel) => Promise<NoteOutcome>
  /** Worktree roots of the caller's repository, as `git worktree list` tells the host (empty outside a repo). */
  checkoutRoots: () => Promise<string[]>
  /** Asks the window (main answers device_screenshot itself); the host adds id, caller and cwd. */
  page: (call: PageAsk) => Promise<McpPageResult>
  /** Tools main answers itself without the window (WP-5: layout daemon, resources, native confirm); absent = unavailable. */
  desk?: (call: DeskAsk) => Promise<McpDeskResult>
}

export type DeskAsk = McpDeskCall extends infer C ? (C extends McpDeskCall ? Omit<C, 'id' | 'from' | 'cwd' | 'pid' | 'name'> : never) : never

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, Json>; required?: string[]; additionalProperties: false }
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; idempotentHint?: boolean }
}

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent: unknown
  isError?: true
}

export interface McpTool {
  def: ToolDef
  call: (args: Json, host: ToolHost) => Promise<ToolResult>
}

export const toolResult = (text: string, structured: unknown, error = false): ToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: structured,
  ...(error ? { isError: true as const } : {}),
})
