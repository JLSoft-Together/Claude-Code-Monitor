import type { McpDeskResult } from '../../../../../packages/shared/src/mcpDesk'
import { toolResult, type McpTool, type ToolDef } from './types'

export const TG_RECEIVE_RATE_MAX = 10
export const TG_RECEIVE_RATE_MS = 60_000

export const TELEGRAM_RECEIVE_TOOL = {
  name: 'telegram_receive',
  description:
    "Turn Orrery's Telegram commands on or off, or read the state (the user's /bot-tele-receive command). While on, the paired Telegram account of the user (and nobody else) can mention the bot in a project topic to send a message into that project's Orrery session. Turning it on asks the user to confirm in a dialog on the machine. Off again after Orrery restarts. Only call it when the user asked for it.",
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: ['on', 'off', 'status'], default: 'status', description: 'on, off, or status to only read it.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Turn Telegram commands on or off', readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
} satisfies ToolDef

const ERRORS: Record<string, string> = {
  state: 'state must be on, off or status.',
  rate: 'Too many calls from this session in the last minute; wait a little.',
  'telegram-config': 'No Telegram bot is set up yet: ask the user to add the bot token in Orrery Settings › Notifications › Telegram.',
  'not-paired': "No Telegram account is paired yet: in Orrery Settings › Notifications › Telegram the user clicks Pair and sends the code to the bot; only that account can send commands.",
  cancelled: 'The user did not allow turning on Telegram commands in the confirm dialog; they stay off.',
  'confirm-open': 'Another Orrery confirm dialog is open; try again after the user answers it.',
  unavailable: 'Orrery cannot change Telegram commands right now.',
  failed: 'Orrery could not change Telegram commands.',
}

export const telegramReceive: McpTool = {
  def: TELEGRAM_RECEIVE_TOOL,
  async call(args, host) {
    const fail = (error: string) => toolResult(ERRORS[error] ?? ERRORS.failed!, { ok: false, error }, true)
    const raw = args.state === undefined || args.state === null || args.state === '' ? 'status' : args.state
    const state = typeof raw === 'string' ? raw.trim().toLowerCase() : raw
    if (state !== 'on' && state !== 'off' && state !== 'status') return fail('state')
    if (!host.take('telegram-receive', TG_RECEIVE_RATE_MAX, TG_RECEIVE_RATE_MS)) return fail('rate')
    if (!host.desk) return fail('unavailable')
    let res: McpDeskResult
    try {
      res = await host.desk({ tool: 'telegram_receive', state })
    } catch {
      res = { ok: false, error: 'failed' }
    }
    if (!res.ok) return fail(res.error)
    if (res.tool !== 'telegram_receive') return fail('failed')
    const who = res.owner ? ` Only ${res.owner} can send.` : ''
    return toolResult(`Telegram commands are ${res.receiving ? 'ON' : 'OFF'}.${res.paired ? who : ' No account is paired yet.'}`, res)
  },
}
