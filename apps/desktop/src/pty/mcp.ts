import { MCP_TOOLS } from './mcpTools'
import type { Json, McpTool, ToolHost } from './mcpTools/types'

export { OPEN_SESSION_TOOL, openText, toOpenResult } from './mcpTools/openSession'
export type { OpenArgs, OpenOutcome, ToolHost } from './mcpTools/types'

export const MCP_PROTOCOL_VERSION = '2025-06-18'

export const MCP_INSTRUCTIONS =
  'This server connects you to the Orrery workspace you run in. Use open_session to open new Claude Code, Codex, DeepSeek or shell sessions as panes instead of launching terminal windows; notify_owner to leave the user a short note; open_in_workspace to show the user a file or its diff; who_is_editing before editing a file other sessions may be changing; run_app, run_status and run_log to run the project app and read its log; device_screenshot to see a connected device; preview_layout to render an Android XML layout; list_servers and free_port for ports your session left listening; hand_back, in a DeepSeek session another agent opened, to return the finished work to that agent.'

const MCP_INSTRUCTIONS_NO_DEEPSEEK =
  'This server connects you to the Orrery workspace you run in. Use open_session to open new Claude Code, Codex or shell sessions as panes instead of launching terminal windows; notify_owner to leave the user a short note; open_in_workspace to show the user a file or its diff; who_is_editing before editing a file other sessions may be changing; run_app, run_status and run_log to run the project app and read its log; device_screenshot to see a connected device; preview_layout to render an Android XML layout; list_servers and free_port for ports your session left listening.'

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

const rpcError = (id: unknown, code: number, message: string): Json => ({ jsonrpc: '2.0', id, error: { code, message } })

const invalid = (): Json => rpcError(null, -32600, 'Invalid Request')

/** A batch runs its calls one after the other on the host's event loop: cap it. */
export const BATCH_MAX = 16

async function answer(msg: unknown, host: ToolHost, version: string, tools: readonly McpTool[]): Promise<Json | undefined> {
  if (!isObj(msg) || msg.jsonrpc !== '2.0') return invalid()
  const { id, method } = msg
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') return invalid()
  if (typeof method !== 'string') return id !== undefined && ('result' in msg || 'error' in msg) ? undefined : invalid()
  if (id === undefined) return undefined
  const ok = (result: unknown): Json => ({ jsonrpc: '2.0', id, result })
  const params = isObj(msg.params) ? msg.params : {}
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion
      return ok({
        protocolVersion: typeof asked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'orrery', version },
        instructions: tools.some((t) => t.def.name === 'hand_back') ? MCP_INSTRUCTIONS : MCP_INSTRUCTIONS_NO_DEEPSEEK,
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: tools.map((t) => t.def) })
    case 'tools/call': {
      const tool = tools.find((t) => t.def.name === params.name)
      if (!tool) return rpcError(id, -32602, 'Unknown tool')
      const args = params.arguments ?? {}
      if (!isObj(args)) return rpcError(id, -32602, 'Invalid arguments')
      return ok(await tool.call(args, host))
    }
    default:
      return rpcError(id, -32601, 'Method not found')
  }
}

export async function handleMcp(body: unknown, host: ToolHost, version: string, tools: readonly McpTool[] = MCP_TOOLS): Promise<{ status: number; json?: unknown }> {
  if (!Array.isArray(body)) {
    const res = await answer(body, host, version, tools)
    return res ? { status: 200, json: res } : { status: 202 }
  }
  if (!body.length) return { status: 200, json: invalid() }
  if (body.length > BATCH_MAX) return { status: 200, json: rpcError(null, -32600, `Invalid Request: at most ${BATCH_MAX} messages per batch`) }
  const out: Json[] = []
  for (const msg of body) {
    const res = await answer(msg, host, version, tools)
    if (res) out.push(res)
  }
  return out.length ? { status: 200, json: out } : { status: 202 }
}

export function mcpGate(
  req: { method?: string; url?: string; host?: string; origin?: string; authorization?: string },
  port: number,
): { status: number; allow?: string } | { token: string } {
  if ((req.url ?? '').split('?')[0] !== '/mcp') return { status: 404 }
  if (req.host !== `127.0.0.1:${port}`) return { status: 403 }
  if (req.origin) return { status: 403 }
  if (req.method !== 'POST') return { status: 405, allow: 'POST' }
  const auth = /^(\S+) ([0-9a-f]{64})$/.exec(req.authorization ?? '')
  if (!auth || auth[1]!.toLowerCase() !== 'bearer') return { status: 401 }
  return { token: auth[2]! }
}
