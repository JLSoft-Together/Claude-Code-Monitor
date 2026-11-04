import type { McpDeskResult } from '../../../../../packages/shared/src/mcpDesk'
import { toolResult, type McpTool, type ToolDef } from './types'

export const TG_NOTIFY_RATE_MAX = 10
export const TG_NOTIFY_RATE_MS = 60_000

export const TELEGRAM_NOTIFY_TOOL = {
  name: 'telegram_notify',
  description:
    'Turn Orrery\'s Telegram reports on or off for the whole app, or read the current state (the user\'s /bot-tele-send-notify command). While on, every session whose project has a Telegram topic reports to that topic when it finishes or waits for the user. Only call it when the user asked for it.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: ['on', 'off', 'status'], default: 'status', description: 'on, off, or status to only read it.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Turn Telegram reports on or off', readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
} satisfies ToolDef

const ERRORS: Record<string, string> = {
  state: 'state must be on, off or status.',
  rate: 'Too many calls from this session in the last minute; wait a little.',
  'telegram-config': 'No Telegram bot is set up yet: ask the user to add the bot token in Orrery Settings › Notifications › Telegram.',
  unavailable: 'Orrery cannot change Telegram reports right now.',
  failed: 'Orrery could not change Telegram reports.',
}

export function notifyText(res: Extract<McpDeskResult, { tool: 'telegram_notify' }>): string {
  const lines = [`Telegram reports are ${res.enabled ? 'ON' : 'OFF'} for the whole app.`]
  lines.push(res.projects.length ? `Projects with a topic: ${res.projects.join(', ')}.` : 'No project has a Telegram topic yet; the user assigns them in Orrery Settings › Notifications › Telegram.')
  if (res.enabled) lines.push(res.routed ? 'This session\'s project has a topic: when a task finishes, send a short result summary (and any build file) with telegram_send.' : 'This session\'s project has no topic, so it is not reported.')
  return lines.join('\n')
}

export const telegramNotify: McpTool = {
  def: TELEGRAM_NOTIFY_TOOL,
  async call(args, host) {
    const fail = (error: string) => toolResult(ERRORS[error] ?? ERRORS.failed!, { ok: false, error }, true)
    const raw = args.state === undefined || args.state === null || args.state === '' ? 'status' : args.state
    const state = typeof raw === 'string' ? raw.trim().toLowerCase() : raw
    if (state !== 'on' && state !== 'off' && state !== 'status') return fail('state')
    if (!host.take('telegram-notify', TG_NOTIFY_RATE_MAX, TG_NOTIFY_RATE_MS)) return fail('rate')
    if (!host.desk) return fail('unavailable')
    let res: McpDeskResult
    try {
      res = await host.desk({ tool: 'telegram_notify', state })
    } catch {
      res = { ok: false, error: 'failed' }
    }
    if (!res.ok) return fail(res.error)
    if (res.tool !== 'telegram_notify') return fail('failed')
    return toolResult(notifyText(res), res)
  },
}
