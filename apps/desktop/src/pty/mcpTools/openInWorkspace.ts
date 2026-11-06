import type { McpPageResult } from '../../../../../packages/shared/src/mcpCall'
import { PATH_MAX, resolveInside, type InsideError } from './paths'
import { toolResult, type McpTool, type ToolDef } from './types'

export const VIEW_RATE_MAX = 20
export const VIEW_RATE_MS = 60_000
const LINE_MAX = 10_000_000

export const OPEN_IN_WORKSPACE_TOOL = {
  name: 'open_in_workspace',
  description:
    "Show the user a file of this session's project in the Orrery workspace, next to this session: the file viewer at a line, or with diff the Changes view (git diff) of that file. Keyboard focus stays where the user is. Use it to point the user at code you want them to look at, instead of pasting it.",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', maxLength: PATH_MAX, description: "File inside this session's project folder: absolute, or relative to the project folder." },
      line: { type: 'integer', minimum: 1, description: 'Line to scroll to (1-based). File viewer only.' },
      diff: { type: 'boolean', default: false, description: 'Show the uncommitted changes of the file (Changes view) instead of the file itself.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  annotations: { title: 'Show a file in Orrery', readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
} satisfies ToolDef

export type ViewError = InsideError | 'line' | 'diff' | 'rate'

const ERRORS: Record<ViewError | 'unavailable' | 'caller' | 'failed' | 'limit' | 'target' | 'busy', string> = {
  path: 'path must be a file path (no UNC or device paths).',
  outside: "That file is outside this session's project folder; only files of the project can be shown.",
  missing: 'That file does not exist.',
  folder: 'That is a folder; give a file.',
  line: 'line must be a whole number from 1.',
  diff: 'diff must be true or false.',
  rate: 'Too many files were shown from this session in the last minute; wait a little.',
  unavailable: 'The Orrery window is not ready right now.',
  caller: 'This session is not an Orrery workspace pane the window knows.',
  limit: 'This session already has 4 file viewers with unsaved edits in its tab; ask the user to save or close one.',
  failed: 'Orrery could not show the file.',
  target: 'Orrery could not do that.',
  busy: 'Orrery could not do that.',
}

export const openInWorkspace: McpTool = {
  def: OPEN_IN_WORKSPACE_TOOL,
  async call(args, host) {
    const fail = (error: keyof typeof ERRORS) => toolResult(ERRORS[error], { ok: false, error }, true)
    if (!host.take('view', VIEW_RATE_MAX, VIEW_RATE_MS)) return fail('rate')
    if (args.diff !== undefined && typeof args.diff !== 'boolean') return fail('diff')
    const diff = args.diff === true
    const line = args.line
    if (line !== undefined && line !== null && (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > LINE_MAX)) return fail('line')
    const target = resolveInside(host.root, args.path, { allowMissing: diff })
    if (!target.ok) return fail(target.error)
    let res: McpPageResult
    try {
      res = await host.page({ tool: 'open_in_workspace', path: target.path, ...(typeof line === 'number' && !diff ? { line } : {}), diff })
    } catch {
      res = { ok: false, error: 'failed' }
    }
    if (!res.ok) return fail(res.error)
    if (res.tool !== 'open_in_workspace') return fail('failed')
    const what = diff ? `the changes of ${target.path}` : `${target.path}${typeof line === 'number' ? ` at line ${line}` : ''}`
    return toolResult(`Showing ${what} in the Orrery workspace${res.reused ? ' (its open viewer)' : ''}.`, { ok: true, path: target.path, diff, reused: res.reused })
  },
}
