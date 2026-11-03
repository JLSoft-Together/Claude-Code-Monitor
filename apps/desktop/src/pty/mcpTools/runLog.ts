import { MCP_LOG_LINES_DEFAULT, MCP_LOG_LINES_MAX } from '../../../../../packages/shared/src/mcpRun'
import { ask, maskRun, maskSession, PAGE_ERRORS, sessionLine } from './runCommon'
import { toolResult, type McpTool, type ToolDef } from './types'

export const RUN_LOG_RATE_MAX = 30
export const RUN_LOG_RATE_MS = 60_000

export const RUN_LOG_TOOL = {
  name: 'run_log',
  description:
    "The last lines of the Run log of this session's project (the run the Run pane shows: build output, app output, logcat), with secrets masked, plus the build errors Orrery parsed (file:line:col). Use errorsOnly to get just error lines.",
  inputSchema: {
    type: 'object',
    properties: {
      lines: { type: 'integer', minimum: 1, maximum: MCP_LOG_LINES_MAX, default: MCP_LOG_LINES_DEFAULT, description: `How many of the last lines, at most ${MCP_LOG_LINES_MAX}.` },
      errorsOnly: { type: 'boolean', default: false, description: 'Only error / fatal lines and lines that read like errors.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Orrery Run log', readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
} satisfies ToolDef

const ERRORS = {
  rate: `At most ${RUN_LOG_RATE_MAX} run_log calls a minute per session; wait a little.`,
  lines: `lines must be a whole number from 1 to ${MCP_LOG_LINES_MAX}.`,
  errorsOnly: 'errorsOnly must be true or false.',
} as const

export const runLog: McpTool = {
  def: RUN_LOG_TOOL,
  async call(args, host) {
    const fail = (error: keyof typeof ERRORS) => toolResult(ERRORS[error], { ok: false, error }, true)
    if (!host.take('runLog', RUN_LOG_RATE_MAX, RUN_LOG_RATE_MS)) return fail('rate')
    const n = args.lines ?? MCP_LOG_LINES_DEFAULT
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MCP_LOG_LINES_MAX) return fail('lines')
    if (args.errorsOnly !== undefined && args.errorsOnly !== null && typeof args.errorsOnly !== 'boolean') return fail('errorsOnly')
    const errorsOnly = args.errorsOnly === true
    const res = await ask(host, { tool: 'run_log', lines: n, errorsOnly })
    if (!res.ok) return toolResult(PAGE_ERRORS[res.error], res, true)
    if (res.tool !== 'run_log') return toolResult(PAGE_ERRORS.failed, { ok: false, error: 'failed' }, true)
    const session = maskSession(res.session)
    if (!session) return toolResult('Nothing has run in this project yet, so there is no Run log.', { ok: true, session: null, lines: [], errors: [] })
    const lines = res.lines.slice(-n).map((l) => ({ ...l, text: maskRun(l.text) }))
    const errors = res.errors.map((e) => ({ ...e, file: maskRun(e.file), message: maskRun(e.message) }))
    const head = `Run: ${sessionLine(session)}${res.partial ? '\n(Output from before the Orrery window reloaded is not available.)' : ''}`
    const body = lines.length ? lines.map((l) => `[${l.stream}${l.level ? ` ${l.level}` : ''}] ${l.text}`).join('\n') : errorsOnly ? '(no error lines)' : '(no output yet)'
    const errs = errors.length ? `\n\nBuild errors:\n${errors.map((e) => `- ${e.file}:${e.line}:${e.col} ${e.severity}: ${e.message}`).join('\n')}` : ''
    return toolResult(`${head}\n\n${body}${errs}`, { ok: true, session, lines, errors, partial: res.partial })
  },
}
