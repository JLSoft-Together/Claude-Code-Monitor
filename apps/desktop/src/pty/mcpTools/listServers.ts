import type { AgentServer, McpDeskResult } from '../../../../../packages/shared/src/mcpDesk'
import { toolResult, type McpTool, type ToolDef } from './types'

export const SERVERS_RATE_MAX = 20
export const SERVERS_RATE_MS = 60_000

export const LIST_SERVERS_TOOL = {
  name: 'list_servers',
  description:
    'List servers and listening ports that agent sessions started (dev servers, daemons, emulators), from Orrery Resources (sampled every 30 s): name, kind, ports, how long idle, and whether it belongs to this session or project (mine: free_port may stop it). Ports held by processes outside every agent are listed by name only.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'List servers and ports', readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
} satisfies ToolDef

const ERRORS: Record<string, string> = {
  rate: 'Too many lists were asked from this session in the last minute; wait a little.',
  'no-report': 'Orrery has no process sample yet (Resources samples every 30 s while the window is open); try again shortly.',
  unavailable: 'Orrery cannot list servers right now.',
  failed: 'Orrery could not list servers.',
}

const idle = (sec: number | null): string => (sec === null ? 'busy' : sec < 60 ? `idle ${sec} s` : sec < 3600 ? `idle ${Math.round(sec / 60)} min` : `idle ${(sec / 3600).toFixed(1)} h`)

function serverLine(s: AgentServer): string {
  const ports = s.ports.length ? `:${s.ports.join(', :')}` : 'no port'
  return `- ${s.mine ? '[mine] ' : ''}${s.name} (${s.kind}, pid ${s.pid}) ${ports} — ${idle(s.idleSec)}${s.orphan ? ', session ended' : ''}${s.cmd ? `\n  ${s.cmd}` : ''}`
}

export function serversText(res: Extract<McpDeskResult, { tool: 'list_servers' }>): string {
  const lines = [`Sample of ${res.at || 'unknown time'}.`]
  lines.push(res.servers.length ? `Agent servers (${res.servers.length}):` : 'No agent servers.', ...res.servers.map(serverLine))
  if (res.outside.length) lines.push('Ports held outside every agent (cannot be freed from Orrery):', ...res.outside.map((o) => `- :${o.port} ${o.name}`))
  return lines.join('\n')
}

export const listServers: McpTool = {
  def: LIST_SERVERS_TOOL,
  async call(_args, host) {
    const fail = (error: string) => toolResult(ERRORS[error] ?? ERRORS.failed!, { ok: false, error }, true)
    if (!host.take('servers', SERVERS_RATE_MAX, SERVERS_RATE_MS)) return fail('rate')
    if (!host.desk) return fail('unavailable')
    let res: McpDeskResult
    try {
      res = await host.desk({ tool: 'list_servers' })
    } catch {
      res = { ok: false, error: 'failed' }
    }
    if (!res.ok) return fail(res.error)
    if (res.tool !== 'list_servers') return fail('failed')
    return toolResult(serversText(res), res)
  },
}
