import { PANE_OPEN_PROMPT_MAX, type PaneOpenError, type PaneOpenResult, type PtyPreset } from '../../../../packages/shared/src/pty'

export interface OpenArgs {
  agent?: unknown
  cwd?: unknown
  prompt?: unknown
  name?: unknown
  resume?: unknown
}

export type OpenOutcome = { ok: true; preset: PtyPreset; cwd: string; sessionId?: string; prompt: boolean; resumed?: boolean } | { ok: false; error: PaneOpenError }

export const MCP_PROTOCOL_VERSION = '2025-06-18'

export const MCP_INSTRUCTIONS =
  'This server opens new Claude Code, Codex or shell sessions as panes in the Orrery workspace; use open_session instead of launching terminal windows.'

export const OPEN_SESSION_TOOL = {
  name: 'open_session',
  description:
    'Open a new Claude Code (default), Codex or shell session as a pane in the Orrery workspace, next to the calling session. Use it instead of starting a terminal window (wt.exe, powershell, cmd start, Terminal.app, iTerm) whenever the user asks to open, start or spawn another session, agent or terminal.',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', enum: ['claude', 'codex', 'shell'], default: 'claude', description: 'Program to run in the new pane.' },
      cwd: { type: 'string', description: "Absolute path of an existing local folder. Defaults to the calling session's current folder." },
      prompt: {
        type: 'string',
        maxLength: PANE_OPEN_PROMPT_MAX,
        description: "Text typed into the new agent's input box once it is ready. It is NOT submitted: the user reviews it and presses Enter. Ignored for shell.",
      },
      name: { type: 'string', maxLength: 40, description: 'Display name of the new session, Claude only. Starts with a letter or digit; then letters, digits, spaces, dots, underscores and dashes.' },
      resume: {
        type: 'string',
        description:
          'Session id (UUID) of an earlier Claude Code or Codex session to continue instead of starting a new one; cwd must be the project folder of that session. If an Orrery pane already runs it, that pane is shown instead.',
      },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Open Orrery session', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}

const LABELS: Record<PtyPreset, string> = { claude: 'Claude Code', codex: 'Codex', shell: 'a shell' }

const ERRORS: Record<PaneOpenError, string> = {
  limit: 'Orrery already runs 16 terminals; the user has to close one first.',
  cwd: 'That folder does not exist or is not allowed; cwd must be an absolute path to an existing local folder.',
  rate: 'Too many sessions were opened from this pane in the last minute; wait before opening another one.',
  unavailable: 'The Orrery window is not ready to open a pane right now.',
  preset: 'Unknown agent; use claude, codex or shell.',
  failed: 'Orrery could not open the pane.',
  resume: 'resume must be the UUID of a Claude Code or Codex session.',
  live: 'That session is still running in another terminal; it has to be closed there first, two instances would write into the same transcript.',
}

const PANE_ERRORS = Object.keys(ERRORS)

export function openText(outcome: OpenOutcome): string {
  if (!outcome.ok) return `${ERRORS[outcome.error] ?? ERRORS.failed} Do not open an external terminal window instead unless the user asks for it.`
  const id = outcome.sessionId ? ` Session id: ${outcome.sessionId}.` : ''
  const prompt = outcome.prompt ? ' The prompt is waiting in its input box; the user presses Enter to send it.' : ''
  if (outcome.resumed) return `Reopened ${LABELS[outcome.preset]} session ${outcome.sessionId} in ${outcome.cwd} as an Orrery pane.${prompt}`
  return `Opened ${LABELS[outcome.preset]} in ${outcome.cwd} as a new Orrery pane next to this session.${id}${prompt}`
}

export function toOpenResult(v: unknown): PaneOpenResult | null {
  if (!isObj(v)) return null
  if (v.ok === true) return { ok: true, paneKey: typeof v.paneKey === 'string' ? v.paneKey : '' }
  if (v.ok !== false || typeof v.error !== 'string') return null
  return { ok: false, error: PANE_ERRORS.includes(v.error) ? (v.error as PaneOpenError) : 'failed' }
}

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

const rpcError = (id: unknown, code: number, message: string): Json => ({ jsonrpc: '2.0', id, error: { code, message } })

const invalid = (): Json => rpcError(null, -32600, 'Invalid Request')

async function answer(msg: unknown, open: (args: OpenArgs) => Promise<OpenOutcome>, version: string): Promise<Json | undefined> {
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
        instructions: MCP_INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: [OPEN_SESSION_TOOL] })
    case 'tools/call': {
      if (params.name !== OPEN_SESSION_TOOL.name) return rpcError(id, -32602, 'Unknown tool')
      const args = params.arguments ?? {}
      if (!isObj(args)) return rpcError(id, -32602, 'Invalid arguments')
      let outcome: OpenOutcome
      try {
        outcome = await open(args)
      } catch {
        outcome = { ok: false, error: 'failed' }
      }
      return ok({ content: [{ type: 'text', text: openText(outcome) }], structuredContent: outcome, ...(outcome.ok ? {} : { isError: true }) })
    }
    default:
      return rpcError(id, -32601, 'Method not found')
  }
}

export async function handleMcp(body: unknown, open: (args: OpenArgs) => Promise<OpenOutcome>, version: string): Promise<{ status: number; json?: unknown }> {
  if (!Array.isArray(body)) {
    const res = await answer(body, open, version)
    return res ? { status: 200, json: res } : { status: 202 }
  }
  if (!body.length) return { status: 200, json: invalid() }
  const out: Json[] = []
  for (const msg of body) {
    const res = await answer(msg, open, version)
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
