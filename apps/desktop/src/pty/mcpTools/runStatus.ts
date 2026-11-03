import { ask, maskRun, maskSession, PAGE_ERRORS, sessionLine } from './runCommon'
import { toolResult, type McpTool, type ToolDef } from './types'

export const RUN_STATUS_RATE_MAX = 30
export const RUN_STATUS_RATE_MS = 60_000

export const RUN_STATUS_TOOL = {
  name: 'run_status',
  description:
    "What runs for this session's project in Orrery: its Run configurations (id, name, which one the Run bar selects), the devices it can run on (serial, name, ready or not) and the recent runs with their state (starting, running, stopping, crashed, stopped) and last error in one line.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'Orrery Run status', readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
} satisfies ToolDef

const q = (v: string): string => JSON.stringify(v)

export const runStatus: McpTool = {
  def: RUN_STATUS_TOOL,
  async call(_args, host) {
    if (!host.take('runStatus', RUN_STATUS_RATE_MAX, RUN_STATUS_RATE_MS))
      return toolResult(`At most ${RUN_STATUS_RATE_MAX} run_status calls a minute per session; wait a little.`, { ok: false, error: 'rate' }, true)
    const res = await ask(host, { tool: 'run_status' })
    if (!res.ok) return toolResult(PAGE_ERRORS[res.error], res, true)
    if (res.tool !== 'run_status') return toolResult(PAGE_ERRORS.failed, { ok: false, error: 'failed' }, true)
    const configs = res.configs.map((c) => ({ ...c, name: maskRun(c.name) }))
    const devices = res.devices.map((d) => ({ ...d, name: maskRun(d.name) }))
    const sessions = res.sessions.map((s) => maskSession(s)!)
    const lines = [
      configs.length
        ? `Run configurations:\n${configs.map((c) => `- ${c.id}: ${q(c.name)} (${c.type}${c.device ? `, pinned to ${c.device}` : ''})${c.selected ? ' [selected]' : ''}`).join('\n')}`
        : 'This project has no Run configuration.',
      devices.length
        ? `Devices:\n${devices.map((d) => `- ${d.serial}: ${q(d.name)} (${d.platform}, ${d.state})${d.selected ? ' [selected]' : ''}`).join('\n')}`
        : 'No device is connected.',
      sessions.length ? `Runs (newest first):\n${sessions.map((s) => `- ${s.id === res.focused ? '[shown] ' : ''}${sessionLine(s)}`).join('\n')}` : 'Nothing has run in this project yet.',
    ]
    return toolResult(lines.join('\n\n'), { ok: true, configs, devices, sessions, focused: res.focused })
  },
}
