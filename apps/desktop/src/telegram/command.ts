import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SEND_COMMAND = 'bot-tele-send-notify'
export const RECEIVE_COMMAND = 'bot-tele-receive'

export const commandsDir = (env: NodeJS.ProcessEnv = process.env): string =>
  path.join(env.CLAUDE_CONFIG_DIR && path.isAbsolute(env.CLAUDE_CONFIG_DIR) ? env.CLAUDE_CONFIG_DIR : path.join(os.homedir(), '.claude'), 'commands')

export const commandFile = (env?: NodeJS.ProcessEnv, name: string = SEND_COMMAND): string => path.join(commandsDir(env), `${name}.md`)

const body = (tool: string, what: string): string => `---
description: Orrery ${what} on / off (on | off | status)
argument-hint: on | off | status
allowed-tools: mcp__orrery__${tool}
---
Call the MCP tool \`mcp__orrery__${tool}\` once with \`state\` set to "$ARGUMENTS" (on, off or status; empty means status).
Then tell the user the result in one short line, in the language they write in. Do nothing else.
If the tool is not available, say that this command only works in a session opened inside Orrery.
`

export const SEND_COMMAND_BODY = body('telegram_notify', 'Telegram reports for the whole app')
export const RECEIVE_COMMAND_BODY = body('telegram_receive', 'Telegram commands into sessions (only the paired account)')

const BODIES: Record<string, string> = { [SEND_COMMAND]: SEND_COMMAND_BODY, [RECEIVE_COMMAND]: RECEIVE_COMMAND_BODY }

export const commandInstalled = (env?: NodeJS.ProcessEnv, name: string = SEND_COMMAND): boolean => existsSync(commandFile(env, name))

export function installCommand(env?: NodeJS.ProcessEnv, name: string = SEND_COMMAND): boolean {
  const file = commandFile(env, name)
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, BODIES[name] ?? SEND_COMMAND_BODY, 'utf8')
    renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}
