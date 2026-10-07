export type TerminalStatus = 'working' | 'waiting' | 'idle' | 'stale' | 'error' | 'unknown'

export type AgentStatus =
  | 'working'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'unknown'

export type AgentRole = 'main' | 'subagent'

export interface TerminalSession {
  id: string
  processId?: number
  parentProcessId?: number
  shell?: string

  title: string
  nameSource?: string
  kind?: string
  entrypoint?: string

  cwd?: string
  claudeSessionId?: string
  claudeVersion?: string

  rawStatus?: string
  status: TerminalStatus
  waitingFor?: string
  backgroundShell?: boolean

  startedAt?: string
  lastActivityAt?: string
  endedAt?: string
}

export interface Agent {
  id: string
  parentId?: string
  terminalId: string

  role: AgentRole
  name?: string
  type?: string
  description?: string
  toolUseId?: string
  spawnDepth?: number
  model?: string

  status: AgentStatus

  currentTool?: string

  startedAt?: string
  updatedAt?: string
  completedAt?: string

  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  totalTokens?: number
}

export type ActivityKind =
  | 'terminal.started'
  | 'terminal.ended'
  | 'terminal.renamed'
  | 'terminal.status'
  | 'session.cleared'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.cancelled'
  | 'tool.started'
  | 'tool.failed'

export interface ActivityEvent {
  id: string
  at: string
  kind: ActivityKind
  terminalId?: string
  agentId?: string
  data?: {
    title?: string
    from?: string
    to?: string
    tool?: string
    agentType?: string
    description?: string
    waitingFor?: string
  }
}

export interface MonitorSnapshot {
  protocolVersion: number
  collectorStartedAt: string
  supportedClaudeVersion: string
  terminals: TerminalSession[]
  agents: Agent[]
  activity: ActivityEvent[]
}

export type Patch<T extends { id: string }> = { [K in Exclude<keyof T, 'id'>]?: T[K] | null } & { id: string }

export type TerminalPatch = Patch<TerminalSession>
export type AgentPatch = Patch<Agent>

export type MonitorEvent =
  | { type: 'snapshot'; payload: MonitorSnapshot }
  | { type: 'terminal.created'; payload: TerminalSession }
  | { type: 'terminal.updated'; payload: TerminalPatch }
  | { type: 'terminal.removed'; payload: { id: string } }
  | { type: 'agent.created'; payload: Agent }
  | { type: 'agent.updated'; payload: AgentPatch }
  | { type: 'agent.removed'; payload: { id: string } }
  | { type: 'activity'; payload: ActivityEvent }

export interface ServerMessage {
  seq: number
  events: MonitorEvent[]
}

export type ClientMessage = { type: 'resync' }
