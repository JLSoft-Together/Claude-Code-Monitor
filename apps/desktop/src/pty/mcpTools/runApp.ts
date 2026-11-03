import { isMcpRunAction, isMcpRunId, MCP_RUN_ACTIONS } from '../../../../../packages/shared/src/mcpRun'
import { ask, maskSession, PAGE_ERRORS, refusalText, sessionLine } from './runCommon'
import { toolResult, type McpTool, type ToolDef } from './types'

export const RUN_APP_RATE_MAX = 6
export const RUN_APP_RATE_MS = 60_000

export const RUN_APP_TOOL = {
  name: 'run_app',
  description:
    "Start, hot reload, restart or stop the app of this session's project with one of its Orrery Run configurations, exactly like the Run pane's buttons (shared or imported configurations still ask the user to trust them). Returns at once with the run's state; follow it with run_status and run_log. Only configurations and devices Orrery lists (run_status) are accepted.",
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...MCP_RUN_ACTIONS], description: 'start: run (refused when already running). reload: hot reload (Flutter debug). restart: stop and run again. stop: the Stop button.' },
      config: { type: 'string', maxLength: 128, description: "Run configuration id from run_status. Default: the one selected in the project's Run bar." },
      device: { type: 'string', maxLength: 128, description: 'Device serial / id from run_status. Default: the device selected in the Run bar (or the one the configuration pins).' },
      full: { type: 'boolean', default: false, description: 'With reload: hot restart instead of hot reload.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  annotations: { title: 'Run the app in Orrery', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
} satisfies ToolDef

const ERRORS = {
  rate: `At most ${RUN_APP_RATE_MAX} run_app calls a minute per session; wait a little.`,
  action: `action must be one of ${MCP_RUN_ACTIONS.join(', ')}.`,
  config: 'config must be a Run configuration id from run_status.',
  device: 'device must be a device serial / id from run_status.',
  full: 'full must be true or false, and only goes with action reload.',
} as const

const DONE = { start: 'Started', restart: 'Restarted', reload: 'Reloaded', stop: 'Stopped' } as const

export const runApp: McpTool = {
  def: RUN_APP_TOOL,
  async call(args, host) {
    const fail = (error: keyof typeof ERRORS) => toolResult(ERRORS[error], { ok: false, error }, true)
    if (!host.take('run', RUN_APP_RATE_MAX, RUN_APP_RATE_MS)) return fail('rate')
    const { action, config, device, full } = args
    if (!isMcpRunAction(action)) return fail('action')
    if (config !== undefined && config !== null && !isMcpRunId(config)) return fail('config')
    if (device !== undefined && device !== null && !isMcpRunId(device)) return fail('device')
    if (full !== undefined && full !== null && (typeof full !== 'boolean' || (full && action !== 'reload'))) return fail('full')
    const res = await ask(host, {
      tool: 'run_app',
      action,
      ...(typeof config === 'string' ? { config } : {}),
      ...(typeof device === 'string' ? { device } : {}),
      ...(full === true ? { full } : {}),
    })
    if (!res.ok) return toolResult(PAGE_ERRORS[res.error], res, true)
    if (res.tool !== 'run_app') return toolResult(PAGE_ERRORS.failed, { ok: false, error: 'failed' }, true)
    const session = maskSession(res.session)
    if (res.refused?.code === 'waiting') return toolResult(refusalText(res.refused), { ok: true, action, pending: true, session })
    if (res.refused) {
      const text = refusalText(res.refused)
      return toolResult(session ? `${text}\nCurrent run: ${sessionLine(session)}` : text, { ok: false, action, refused: { code: res.refused.code }, session }, true)
    }
    const what = action === 'reload' && full === true ? 'Hot restarted' : DONE[action]
    const text = session ? `${what}: ${sessionLine(session)}.${action === 'stop' ? '' : ' Call run_status / run_log to follow it.'}` : `${what}.`
    return toolResult(text, { ok: true, action, session })
  },
}
