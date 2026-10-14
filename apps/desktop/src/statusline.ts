import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Quick setup's "status line bridge" row: the one place the app writes Claude Code's config, after a native confirm
 * (docs/claude-code-integration.md §11q). Other keys are kept, the previous file is backed up next to it.
 */

export type StatusLineState = 'ours' | 'other' | 'none' | 'unreadable'

export interface StatusLineRead {
  state: StatusLineState
  /** The command configured now (state 'ours' | 'other'). */
  command?: string
  settings?: Record<string, unknown>
}

export const BRIDGE_MARK = 'statusline-bridge'
export const BACKUP_SUFFIX = '.ccm-backup'

export const claudeSettingsFile = (env: NodeJS.ProcessEnv, home: string): string =>
  path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json')

export function readStatusLine(file: string): StatusLineRead {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'none', settings: {} } : { state: 'unreadable' }
  }
  let settings: unknown
  try {
    settings = text.trim() ? JSON.parse(text) : {}
  } catch {
    return { state: 'unreadable' }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { state: 'unreadable' }
  const s = settings as Record<string, unknown>
  const line = s.statusLine
  const command = line && typeof line === 'object' ? (line as Record<string, unknown>).command : undefined
  if (typeof command !== 'string' || !command.trim()) return { state: 'none', settings: s }
  return { state: command.includes(BRIDGE_MARK) ? 'ours' : 'other', command, settings: s }
}

/** Bridge command, chaining a status line the user already had. Base64 keeps the old command shell-safe in any shell. */
export function bridgeCommand(bridge: string, previous?: string): string {
  return previous ? `${bridge} --chain-b64 ${Buffer.from(previous, 'utf8').toString('base64')}` : bridge
}

export function plannedStatusLine(read: StatusLineRead, bridge: string): Record<string, unknown> {
  const old = read.settings?.statusLine
  const keep = old && typeof old === 'object' && !Array.isArray(old) ? (old as Record<string, unknown>) : {}
  return { ...keep, type: 'command', command: bridgeCommand(bridge, read.state === 'other' ? read.command : undefined) }
}

export type EnableResult = 'ok' | 'ours' | 'unreadable' | 'failed'

export function writeStatusLine(file: string, read: StatusLineRead, bridge: string): EnableResult {
  if (read.state === 'ours') return 'ours'
  if (read.state === 'unreadable' || !read.settings) return 'unreadable'
  const next = { ...read.settings, statusLine: plannedStatusLine(read, bridge) }
  const tmp = `${file}.ccm-tmp`
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    if (existsSync(file)) copyFileSync(file, `${file}${BACKUP_SUFFIX}`)
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(tmp, file)
    return 'ok'
  } catch {
    return 'failed'
  }
}
