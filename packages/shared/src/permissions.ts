/** One permission dialog Claude Code showed (hook `PermissionRequest`, recorded by the hook bridge). */
export interface PermAsk {
  /** ISO time the dialog opened. */
  at: string
  tool: string
  /** Allow rules Claude Code itself suggested for this dialog (`permission_suggestions`), safe ones only. */
  rules: string[]
  /** Shell tools: the first one or two safe words of the command, for a `Tool(prefix:*)` suggestion. */
  prefix?: string
}

export interface PermRuleSet {
  allow: string[]
  deny: string[]
}

export type PermFileState = 'none' | 'ok' | 'unreadable'

export type PermRead =
  | {
      ok: true
      root: string
      /** Last `PERM_ASK_DAYS` days, sessions whose folder is inside `root`, oldest first. */
      asks: PermAsk[]
      shared: PermRuleSet & { state: PermFileState }
      local: PermRuleSet & { state: PermFileState }
    }
  | { ok: false; error: 'denied' | 'unavailable' }

export type PermWrite = { ok: true; added: string[] } | { ok: false; error: 'denied' | 'invalid' | 'risky' | 'unreadable' | 'changed' | 'cancelled' | 'failed' | 'unavailable' }

export const PERM_ASK_DAYS = 7
export const PERM_RULES_MAX = 20

const RULE = /^([A-Za-z][\w-]{0,127})(?:\(([^()\r\n]{1,200})\))?$/
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const SHELL_META = /[;&|`$<>\n\\"']/
// First word of a shell rule that hands out arbitrary execution, deletion or network writes.
const RISKY_COMMANDS = new Set(['rm', 'rmdir', 'del', 'sudo', 'su', 'doas', 'chmod', 'chown', 'curl', 'wget', 'ssh', 'scp', 'sh', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd', 'eval', 'exec', 'xargs', 'env', 'node', 'python', 'python3', 'npx', 'dd', 'mkfs', 'format', 'kill', 'pkill', 'shutdown', 'reboot', 'Remove-Item', 'Invoke-Expression', 'iex'])
const RISKY_GIT = /^git\s+(?:push|reset|clean|rebase|filter-branch|checkout\s+--|restore|branch\s+-D)\b/

export interface PermRule {
  tool: string
  content?: string
}

export function parsePermRule(rule: unknown): PermRule | null {
  if (typeof rule !== 'string') return null
  const m = RULE.exec(rule.trim())
  if (!m) return null
  return m[2] === undefined ? { tool: m[1]! } : { tool: m[1]!, content: m[2]!.trim() }
}

/** Rules Orrery never suggests or writes: whole shell, wildcards for everything, deletion / remote / interpreter commands. */
export function isRiskyPermRule(rule: string): boolean {
  const r = parsePermRule(rule)
  if (!r) return true
  const c = r.content
  if (c !== undefined && /^[*:\s]*$/.test(c)) return true
  if (!SHELL_TOOLS.has(r.tool)) return c === '**' || c === '/**' || c === '//**'
  if (c === undefined) return true
  if (SHELL_META.test(c)) return true
  const first = c.split(/[\s:]/)[0] ?? ''
  return RISKY_COMMANDS.has(first) || RISKY_COMMANDS.has(first.toLowerCase()) || RISKY_GIT.test(c)
}

const prefixOf = (c: string): string => c.replace(/(?::\*|\s+\*)$/, '').trim()

/** An existing allow rule already lets `rule` through: same rule, the bare tool, or a shorter `prefix:*` of a shell command. */
export function permRuleCovered(rule: string, allow: readonly string[]): boolean {
  const r = parsePermRule(rule)
  if (!r) return false
  for (const a of allow) {
    const e = parsePermRule(a)
    if (!e || e.tool !== r.tool) continue
    if (e.content === undefined || e.content === r.content) return true
    if (SHELL_TOOLS.has(r.tool) && r.content && /(?::\*|\s+\*)$/.test(e.content)) {
      const p = prefixOf(e.content)
      const mine = prefixOf(r.content)
      if (p && (mine === p || mine.startsWith(`${p} `))) return true
    }
  }
  return false
}
