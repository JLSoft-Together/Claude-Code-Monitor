/** Claude Code hooks manager (v74, docs §11ad): rows shown in Extensions → Hooks. */

export type HookSource = 'user' | 'project' | 'local' | 'plugin'

/** Event order of the table; events Claude Code adds later sort after these by name. */
export const HOOK_EVENT_ORDER = [
  'Setup',
  'SessionStart',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'TeammateIdle',
  'SessionEnd',
] as const

export const HOOK_TEST_TIMEOUT_MS = 10_000
export const HOOK_TEST_OUTPUT_MAX = 4096

export interface HookRow {
  /** Stable key (file + event + matcher + entry); the main process resolves it again, the page never sends a command. */
  id: string
  event: string
  matcher: string | null
  /** `command`, `http`, `prompt`, `agent`, `mcp_tool` or what the file says. */
  type: string
  /** Command / URL / tool, home folder and anything token-like masked. */
  text: string
  timeout: number | null
  async: boolean
  source: HookSource
  /** Plugin id (`name@marketplace`) for plugin hooks. */
  plugin?: string
  pluginEnabled?: boolean
  /** Orrery's own hook bridge: never toggled or test-run. */
  orrery: boolean
  /** False = moved to Orrery's stash (off). */
  enabled: boolean
  toggleable: boolean
  testable: boolean
}

export type HookFileState = 'ok' | 'none' | 'unreadable'

export type HooksListResult =
  | { ok: true; dir: string | null; rows: HookRow[]; files: { source: Exclude<HookSource, 'plugin'>; state: HookFileState }[]; disableAll: boolean }
  | { ok: false; error: 'invalid' | 'unavailable' }

export type HookToggleError = 'invalid' | 'notFound' | 'readOnly' | 'orrery' | 'unreadable' | 'changed' | 'cancelled' | 'denied' | 'busy' | 'failed'
export type HookToggleResult = { ok: true } | { ok: false; error: HookToggleError }

export type HookTestResult =
  | { ok: true; code: number | null; timedOut: boolean; ms: number; stdout: string; stderr: string; truncated: boolean }
  | { ok: false; error: 'invalid' | 'notFound' | 'notTestable' | 'cancelled' | 'busy' | 'spawn' }

export function hookEventRank(event: string): number {
  const i = (HOOK_EVENT_ORDER as readonly string[]).indexOf(event)
  return i < 0 ? HOOK_EVENT_ORDER.length : i
}
