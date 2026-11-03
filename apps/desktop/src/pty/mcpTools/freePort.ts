import type { McpDeskResult } from '../../../../../packages/shared/src/mcpDesk'
import { toolResult, type McpTool, type ToolDef } from './types'

// Each call can put a native dialog in front of the owner.
export const FREE_PORT_RATE_MAX = 3
export const FREE_PORT_RATE_MS = 60_000

export const FREE_PORT_TOOL = {
  name: 'free_port',
  description:
    "Stop the process listening on a local port, only when it was started from this session (its process tree or agent session) or runs inside this session's project folder. The user always confirms in a native Orrery dialog first; the answer says whether it was stopped or the user declined. Use list_servers to see which ports are yours.",
  inputSchema: {
    type: 'object',
    properties: { port: { type: 'integer', minimum: 1, maximum: 65535, description: 'Local TCP port to free.' } },
    required: ['port'],
    additionalProperties: false,
  },
  annotations: { title: 'Free a port (asks the user)', readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
} satisfies ToolDef

const ERRORS: Record<string, string> = {
  port: 'port must be a whole number from 1 to 65535.',
  rate: 'Too many ports were freed from this session in the last minute; wait a little.',
  'no-report': 'Orrery has no process sample yet (Resources samples every 30 s while the window is open); try again shortly.',
  'not-found': 'No agent server listens on that port in the latest Orrery sample (taken every 30 s); a server started just now may need a moment.',
  'not-mine': "That port is held by a process another session or project started; it can only be stopped from Orrery's Resources by the user.",
  outside: 'That port is held by a process outside every agent session; Orrery never stops those.',
  emulator: 'That port belongs to an Android emulator; ask the user to stop it from Orrery Devices.',
  self: "That port is held by an agent session itself, not a server; it can't be freed this way.",
  busy: 'That daemon is building right now (CPU in the last 2 minutes); try again later.',
  gone: 'That process already exited or was replaced.',
  cancelled: 'The user declined: nothing was stopped.',
  'confirm-open': 'Another stop request is already waiting for the user; try again after they answer it.',
  unavailable: 'Orrery cannot stop processes right now.',
  failed: 'Orrery could not stop the process.',
}

export const freePort: McpTool = {
  def: FREE_PORT_TOOL,
  async call(args, host) {
    const fail = (error: string, detail?: string) => toolResult(`${ERRORS[error] ?? ERRORS.failed}${detail ? ` (${detail})` : ''}`, { ok: false, error }, true)
    const port = args.port
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return fail('port')
    if (!host.take('free-port', FREE_PORT_RATE_MAX, FREE_PORT_RATE_MS)) return fail('rate')
    if (!host.desk) return fail('unavailable')
    let res: McpDeskResult
    try {
      res = await host.desk({ tool: 'free_port', port })
    } catch {
      res = { ok: false, error: 'failed' }
    }
    if (!res.ok) return fail(res.error, res.error === 'not-mine' || res.error === 'outside' ? res.detail : undefined)
    if (res.tool !== 'free_port') return fail('failed')
    const names = res.stopped.map((s) => `${s.name} (pid ${s.pid})`).join(', ')
    return toolResult(`The user confirmed: stopped ${names}; port ${res.port} is free once it has exited.`, res)
  },
}
