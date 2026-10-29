import { isRiskyPermRule, parsePermRule, permRuleCovered, type PermAsk, type PermRead, type PermRuleSet, type PermWrite } from '@ccm/shared'
import { desktop } from './desktop'

interface PermBridge {
  permRead?: (root: string) => Promise<PermRead>
  permAllow?: (root: string, rules: string[]) => Promise<PermWrite>
}

const bridge = desktop as unknown as PermBridge | undefined

export const hasPermAdvisor = typeof bridge?.permRead === 'function'
export const permRead = (root: string): Promise<PermRead> => bridge?.permRead?.(root) ?? Promise.resolve({ ok: false, error: 'unavailable' })
/** Desktop shows the settings.local.json diff in a native confirm before writing. */
export const permAllow = (root: string, rules: string[]): Promise<PermWrite> => bridge?.permAllow?.(root, [...rules]) ?? Promise.resolve({ ok: false, error: 'unavailable' })

const SHELLS = new Set(['Bash', 'PowerShell'])
// A bare rule for these would allow every command / every domain.
const NO_BARE = new Set(['Bash', 'PowerShell', 'WebFetch'])

/** Claude Code's own suggestion first, else `Tool(prefix:*)` for shells, else the bare tool when that is narrow enough. */
export function suggestFor(ask: PermAsk): string | null {
  if (ask.rules[0]) return ask.rules[0]
  if (SHELLS.has(ask.tool)) return ask.prefix ? `${ask.tool}(${ask.prefix}:*)` : null
  return NO_BARE.has(ask.tool) || !parsePermRule(ask.tool) ? null : ask.tool
}

export type Coverage = 'shared' | 'local' | 'denied' | null

export interface PermAdvice {
  key: string
  tool: string
  /** null: no safe pattern for this tool. */
  rule: string | null
  count: number
  lastAt: string
  /** Suggested, but a rule Orrery never writes (whole shell, rm, curl, git push…): shown as a warning only. */
  risky: boolean
  covered: Coverage
}

function coverage(rule: string, shared: PermRuleSet, local: PermRuleSet): Coverage {
  if (shared.deny.includes(rule) || local.deny.includes(rule)) return 'denied'
  if (permRuleCovered(rule, shared.allow)) return 'shared'
  if (permRuleCovered(rule, local.allow)) return 'local'
  return null
}

/** Repeated permission dialogs grouped by the rule that would stop them, most frequent first. */
export function adviseRules(asks: readonly PermAsk[], shared: PermRuleSet, local: PermRuleSet): PermAdvice[] {
  const map = new Map<string, PermAdvice>()
  for (const a of asks) {
    const rule = suggestFor(a)
    const key = rule ?? `tool:${a.tool}`
    const hit = map.get(key)
    if (hit) {
      hit.count++
      if (a.at > hit.lastAt) hit.lastAt = a.at
      continue
    }
    map.set(key, { key, tool: a.tool, rule, count: 1, lastAt: a.at, risky: !!rule && isRiskyPermRule(rule), covered: rule ? coverage(rule, shared, local) : null })
  }
  return [...map.values()].sort((x, y) => y.count - x.count || y.lastAt.localeCompare(x.lastAt))
}

/** Rows that can be ticked: a safe rule not already allowed or denied. */
export const tickable = (a: PermAdvice): boolean => !!a.rule && !a.risky && !a.covered

/** Owner edits a suggestion: it must stay one valid, non-risky rule. */
export function editedRule(text: string): { rule: string } | { error: 'invalid' | 'risky' } {
  const r = parsePermRule(text)
  if (!r) return { error: 'invalid' }
  const rule = r.content === undefined ? r.tool : `${r.tool}(${r.content})`
  return isRiskyPermRule(rule) ? { error: 'risky' } : { rule }
}

export interface DeniedTool {
  tool: string
  sessions: number
}

/** Auto-mode denials (hook bridge `deniedTools`) of the sessions inside the project. */
export function deniedTools(sessions: readonly { cwd?: string; deniedCount?: number; deniedTools?: string[] }[], inside: (cwd: string) => boolean): { total: number; tools: DeniedTool[] } {
  let total = 0
  const tools = new Map<string, number>()
  for (const s of sessions) {
    if (!s.cwd || !inside(s.cwd) || !s.deniedCount) continue
    total += s.deniedCount
    for (const t of new Set(s.deniedTools ?? [])) tools.set(t, (tools.get(t) ?? 0) + 1)
  }
  return { total, tools: [...tools.entries()].map(([tool, sessions]) => ({ tool, sessions })).sort((a, b) => b.sessions - a.sessions || a.tool.localeCompare(b.tool)) }
}
