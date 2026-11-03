import { statSync } from 'node:fs'
import { AGENT_NOTE_MAX, cleanNoteText, type McpPageResult } from '../../../../../packages/shared/src/mcpCall'
import { PATH_MAX, resolveInside, type InsideError } from './paths'
import { toolResult, type McpTool, type ToolDef } from './types'

export const HAND_BACK_RATE_MS = 120_000
export const REPORT_MAX_BYTES = 1024 * 1024

export const HAND_BACK_TOOL = {
  name: 'hand_back',
  description:
    'DeepSeek sessions opened by another Orrery agent only: when the task you were given is finished, write a Markdown report in your project folder (what you did, files changed, tests run and their result, what is left), then call this once. Orrery submits a prompt pointing at the report into the agent that opened you as soon as it is idle. Stop working on the task after it succeeds.',
  inputSchema: {
    type: 'object',
    properties: {
      report: { type: 'string', maxLength: PATH_MAX, description: 'Path of the .md report you wrote, inside your project folder: absolute, or relative to the project folder. At most 1 MB.' },
      summary: { type: 'string', minLength: 1, maxLength: AGENT_NOTE_MAX, description: 'One line saying what was done, at most 200 characters.' },
    },
    required: ['report', 'summary'],
    additionalProperties: false,
  },
  annotations: { title: 'Hand work back in Orrery', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
} satisfies ToolDef

export type HandBackError = InsideError | 'preset' | 'markdown' | 'size' | 'summary' | 'rate'

const ERRORS: Record<HandBackError | 'unavailable' | 'caller' | 'failed' | 'limit', string> = {
  preset: 'hand_back is only for DeepSeek sessions opened by another agent',
  path: 'report must be a file path (no UNC or device paths).',
  outside: "The report is outside this session's project folder; write it inside the project.",
  missing: 'The report file does not exist; write it first.',
  folder: 'report is a folder; give the .md file.',
  markdown: 'The report must be a Markdown file ending in .md.',
  size: 'The report is larger than 1 MB; shorten it.',
  summary: 'summary must be one non-empty line of at most 200 characters.',
  rate: 'This session already handed back in the last 2 minutes; wait before handing back again.',
  unavailable: 'The Orrery window is not ready right now; try again in a moment.',
  caller: 'This session was not opened by another Orrery pane (or that pane is closed), so there is nobody to hand back to; tell the user instead.',
  limit: 'Orrery could not queue the hand-back.',
  failed: 'Orrery could not hand the work back.',
}

export const handBack: McpTool = {
  def: HAND_BACK_TOOL,
  async call(args, host) {
    const fail = (error: keyof typeof ERRORS) => toolResult(ERRORS[error], { ok: false, error }, true)
    if (host.preset !== 'deepseek') return fail('preset')
    if (typeof args.summary !== 'string' || [...args.summary].length > AGENT_NOTE_MAX) return fail('summary')
    const summary = cleanNoteText(args.summary)
    if (!summary) return fail('summary')
    const target = resolveInside(host.root, args.report)
    if (!target.ok) return fail(target.error)
    if (!/\.md$/i.test(target.path)) return fail('markdown')
    try {
      if (statSync(target.path).size > REPORT_MAX_BYTES) return fail('size')
    } catch {
      return fail('missing')
    }
    if (!host.take('hand_back', 1, HAND_BACK_RATE_MS)) return fail('rate')
    let res: McpPageResult
    try {
      res = await host.page({ tool: 'hand_back', report: target.path, summary })
    } catch {
      res = { ok: false, error: 'failed' }
    }
    if (!res.ok) return fail(res.error)
    if (res.tool !== 'hand_back') return fail('failed')
    return toolResult(`Handed back to ${res.origin}. Orrery submits the prompt there as soon as it is idle; stop working on this task now.`, { ok: true, report: target.path, origin: res.origin })
  },
}
