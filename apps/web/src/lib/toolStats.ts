import type { ExtStatus, ToolStatEntry, ToolStats } from '@ccm/shared'

export type StatGroup = 'tools' | 'skills' | 'agents' | 'mcp'
export const STAT_GROUPS: readonly StatGroup[] = ['tools', 'skills', 'agents', 'mcp']
export const TOP_ROWS = 8

export interface UnusedItem {
  kind: 'skill' | 'mcp'
  name: string
  scope: 'user' | 'project'
}

/** Claude Code names MCP tools `mcp__<server>__…` with the server name reduced to this charset. */
export const mcpToolName = (server: string): string => server.replace(/[^A-Za-z0-9_-]/g, '_').toLowerCase()

/** Installed skills and configured MCP servers with no call in the last 30 days (same project filter as `stats`). */
export function unusedItems(status: ExtStatus | null, stats: ToolStats | null): UnusedItem[] {
  if (!status || !stats) return []
  const skills = new Set(stats.used30.skills.map((s) => s.toLowerCase()))
  const mcp = new Set(stats.used30.mcp.map(mcpToolName))
  const out: UnusedItem[] = []
  const seen = new Set<string>()
  const addSkill = (name: string, scope: UnusedItem['scope']): void => {
    const key = name.toLowerCase()
    if (skills.has(key) || seen.has(`s:${key}`)) return
    seen.add(`s:${key}`)
    out.push({ kind: 'skill', name, scope })
  }
  for (const s of status.skills.project) addSkill(s, 'project')
  for (const s of status.skills.user) addSkill(s, 'user')
  for (const c of status.configured) {
    if (mcp.has(mcpToolName(c.name))) continue
    out.push({ kind: 'mcp', name: c.name, scope: c.scopes.includes('user') ? 'user' : 'project' })
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'mcp' ? -1 : 1))
}

/** Share of answers that came back `is_error`, 0..1; null when nothing was called. */
export const errorRate = (e: ToolStatEntry): number | null => (e.n > 0 && e.errors !== undefined ? e.errors / e.n : null)

export const barScale = (n: number, max: number): number => (max > 0 ? Math.max(0.02, n / max) : 0)

export const totalCalls = (list: ToolStatEntry[]): number => list.reduce((a, e) => a + e.n, 0)
