import { contextRawPct, contextUsedPct, type Agent, type Provider } from '@ccm/shared'

export const isCodex = (x: { provider?: Provider } | null | undefined): boolean => x?.provider === 'codex'
export const isDeepseek = (x: { provider?: Provider } | null | undefined): boolean => x?.provider === 'deepseek'

/** Provider shown as a badge: sessions and agents that are not Claude Code (Claude is the unmarked default). */
export type BadgeProvider = Exclude<Provider, 'claude'>
export const badgeOf = (x: { provider?: Provider } | null | undefined): BadgeProvider | null =>
  x?.provider === 'codex' || x?.provider === 'deepseek' ? x.provider : null

/** Gauge % for any agent: the collector's own value, else Claude's room-before-compact or Codex's plain ratio (no Claude buffer). */
export function contextPctOf(agent: Pick<Agent, 'provider' | 'contextPct' | 'contextTokens' | 'contextWindow'>): number | undefined {
  if (agent.contextPct !== undefined) return agent.contextPct
  if (agent.contextTokens === undefined || !agent.contextWindow) return undefined
  return isCodex(agent) ? contextRawPct(agent.contextTokens, agent.contextWindow) : contextUsedPct(agent.contextTokens, agent.contextWindow)
}

export const CODEX_MODES = ['exec', 'tui', 'plugin', 'subagent', 'app-server'] as const
export type CodexMode = (typeof CODEX_MODES)[number]

export const codexMode = (value: string | undefined): CodexMode | null =>
  CODEX_MODES.includes(value as CodexMode) ? (value as CodexMode) : null
