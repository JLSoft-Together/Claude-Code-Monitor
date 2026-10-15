import type { Agent, TerminalSession } from '@ccm/shared'
import { duration } from './format'
import { treeOrder } from './layout'
import { isCodex } from './provider'
import { displayTitle } from './title'

export type SummaryField = 'name' | 'kind' | 'status' | 'model' | 'tool' | 'task' | 'session' | 'sessionId' | 'agentId' | 'cwd' | 'branch' | 'started' | 'duration'

export interface MapTextLabels {
  status: (status: string) => string
  field: (field: SummaryField) => string
  main: string
  subagent: string
  codexRun: string
}

type Term = Pick<TerminalSession, 'title' | 'alias' | 'cwd' | 'gitBranch' | 'claudeSessionId' | 'codexSessionId' | 'provider' | 'status'>

export function sessionIdOf(terminal: Term | undefined): string | undefined {
  if (!terminal) return undefined
  return isCodex(terminal) ? terminal.codexSessionId : terminal.claudeSessionId
}

/** Same name the map node shows. */
export function agentName(agent: Agent, terminal: Term | undefined, labels: Pick<MapTextLabels, 'subagent' | 'codexRun'>): string {
  if (agent.role === 'main') return displayTitle(terminal) || agent.name || agent.id
  if (isCodex(agent)) return agent.name ?? labels.codexRun
  return agent.type ?? agent.name ?? labels.subagent
}

export function agentKind(agent: Agent, labels: Pick<MapTextLabels, 'main' | 'subagent' | 'codexRun'>): string {
  if (agent.role === 'main') return labels.main
  if (isCodex(agent)) return labels.codexRun
  return agent.type ? `${labels.subagent} · ${agent.type}` : labels.subagent
}

/** Running agents count up to `nowMs`; finished ones stop at their end (completedAt, else last update). */
export function agentDuration(agent: Agent, nowMs: number): string | null {
  const ended = agent.status === 'completed' || agent.status === 'cancelled' || agent.status === 'error'
  const endIso = ended ? (agent.completedAt ?? agent.updatedAt) : undefined
  const end = endIso ? Date.parse(endIso) : nowMs
  return duration(agent.startedAt, Number.isFinite(end) ? end : nowMs)
}

export function agentSummary(agent: Agent, terminal: Term | undefined, labels: MapTextLabels, nowMs: number): string {
  const rows: [SummaryField, string | null | undefined][] = [
    ['name', agentName(agent, terminal, labels)],
    ['kind', agentKind(agent, labels)],
    ['status', labels.status(agent.status)],
    ['model', agent.model],
    ['tool', agent.currentTool],
    ['task', agent.role === 'main' ? undefined : agent.description],
    ['session', agent.role === 'main' ? undefined : displayTitle(terminal) || undefined],
    ['sessionId', sessionIdOf(terminal)],
    ['agentId', agent.id],
    ['cwd', terminal?.cwd],
    ['branch', terminal?.gitBranch],
    ['started', agent.startedAt],
    ['duration', agentDuration(agent, nowMs)],
  ]
  return rows
    .filter((r): r is [SummaryField, string] => !!r[1])
    .map(([k, v]) => `${labels.field(k)}: ${v}`)
    .join('\n')
}

function treeLine(agent: Agent, terminal: Term | undefined, labels: MapTextLabels): string {
  const name = agent.role === 'main' ? labels.main : agentName(agent, terminal, labels)
  const parts = [`${name} [${labels.status(agent.status)}]`]
  if (agent.model) parts.push(agent.model)
  if (agent.currentTool && (agent.status === 'working' || agent.status === 'waiting')) parts.push(agent.currentTool)
  if (agent.role !== 'main' && agent.description) parts.push(agent.description)
  return parts.join(' · ')
}

/** Indented tree, one block per session: header (title, cwd, branch) then main agent and subagents by depth. */
export function mapTree(sessions: { terminal: Term | undefined; agents: Agent[] }[], labels: MapTextLabels): string {
  const blocks: string[] = []
  for (const { terminal, agents } of sessions) {
    if (!agents.length) continue
    const head = [displayTitle(terminal) || labels.main]
    if (terminal?.cwd) head.push(terminal.cwd)
    if (terminal?.gitBranch) head.push(`(${terminal.gitBranch})`)
    const lines = [head.join(' — ')]
    const main = agents.find((a) => a.role === 'main')
    if (main) lines.push(`- ${treeLine(main, terminal, labels)}`)
    for (const { agent, depth } of treeOrder(agents)) lines.push(`${'  '.repeat(main ? depth : depth - 1)}- ${treeLine(agent, terminal, labels)}`)
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

/** Text the find box matches against: what the node shows plus ids. */
export function searchText(agent: Agent, terminal: Term | undefined, labels: Pick<MapTextLabels, 'subagent' | 'codexRun'>): string {
  return [agentName(agent, terminal, labels), agent.name, agent.type, agent.description, agent.model, agent.id].filter(Boolean).join('\n').toLowerCase()
}
