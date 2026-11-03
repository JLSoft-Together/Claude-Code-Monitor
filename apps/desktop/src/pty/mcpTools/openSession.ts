import { PANE_OPEN_PROMPT_MAX, type PaneOpenError, type PaneOpenResult, type PtyPreset } from '../../../../../packages/shared/src/pty'
import { toolResult, type McpTool, type OpenOutcome, type ToolDef } from './types'

/** `deepseek` off (v81 owner pause, `CCM_DEEPSEEK_FEATURE` unset): agents cannot open DeepSeek panes. */
export const openSessionDef = (deepseek: boolean) =>
  ({
  name: 'open_session',
  description:
    deepseek
      ? 'Open a new Claude Code (default), Codex, DeepSeek (Codewhale) or shell session as a pane in the Orrery workspace, next to the calling session. Use it instead of starting a terminal window (wt.exe, powershell, cmd start, Terminal.app, iTerm) whenever the user asks to open, start or spawn another session, agent or terminal. DeepSeek is for side code, generating tests and running the clone-app-re skill; when you hand it work, the prompt should state the goal, the files it may change, the test command and when it is done, and ask it to call hand_back when finished so its report comes back to you.'
      : 'Open a new Claude Code (default), Codex or shell session as a pane in the Orrery workspace, next to the calling session. Use it instead of starting a terminal window (wt.exe, powershell, cmd start, Terminal.app, iTerm) whenever the user asks to open, start or spawn another session, agent or terminal.',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', enum: deepseek ? ['claude', 'codex', 'deepseek', 'shell'] : ['claude', 'codex', 'shell'], default: 'claude', description: 'Program to run in the new pane.' },
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
          'Session id (UUID) of an earlier Claude Code, Codex or DeepSeek session to continue instead of starting a new one; cwd must be the project folder of that session. If an Orrery pane already runs it, that pane is shown instead.',
      },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Open Orrery session', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}) satisfies ToolDef

export const OPEN_SESSION_TOOL = openSessionDef(true)

const LABELS: Record<PtyPreset, string> = { claude: 'Claude Code', codex: 'Codex', deepseek: 'DeepSeek (Codewhale)', shell: 'a shell' }

const ERRORS: Record<PaneOpenError, string> = {
  limit: 'Orrery already runs 16 terminals; the user has to close one first.',
  cwd: 'That folder does not exist or is not allowed; cwd must be an absolute path to an existing local folder.',
  rate: 'Too many sessions were opened from this pane in the last minute; wait before opening another one.',
  unavailable: 'The Orrery window is not ready to open a pane right now.',
  preset: 'Unknown agent; use claude, codex or shell (deepseek only while the user has it turned on).',
  failed: 'Orrery could not open the pane.',
  resume: 'resume must be the UUID of a Claude Code, Codex or DeepSeek session.',
  live: 'That session is still running in another terminal; it has to be closed there first, two instances would write into the same transcript.',
  setup:
    'DeepSeek (Codewhale) is not installed or not logged in on this machine; Orrery showed the user a notice with a button to the setup page. Do the task yourself or ask the user to finish the setup, do not open an external terminal.',
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
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (r.ok === true) return { ok: true, paneKey: typeof r.paneKey === 'string' ? r.paneKey : '' }
  if (r.ok !== false || typeof r.error !== 'string') return null
  return { ok: false, error: PANE_ERRORS.includes(r.error) ? (r.error as PaneOpenError) : 'failed' }
}

export const openSession: McpTool = {
  def: OPEN_SESSION_TOOL,
  async call(args, host) {
    let outcome: OpenOutcome
    try {
      outcome = await host.openSession(args)
    } catch {
      outcome = { ok: false, error: 'failed' }
    }
    return toolResult(openText(outcome), outcome, !outcome.ok)
  },
}
