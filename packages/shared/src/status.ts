import type { AgentStatus, TerminalStatus } from './types'

export const PROTOCOL_VERSION = 1
export const SUPPORTED_CLAUDE_VERSION = '2.1.289'

export interface MappedTerminalStatus {
  status: TerminalStatus
  backgroundShell: boolean
}

export function mapRegistryStatus(raw: string | undefined): MappedTerminalStatus {
  switch (raw) {
    case 'busy':
      return { status: 'working', backgroundShell: false }
    case 'waiting':
      return { status: 'waiting', backgroundShell: false }
    case 'shell':
      return { status: 'idle', backgroundShell: true }
    case 'idle':
      return { status: 'idle', backgroundShell: false }
    default:
      return { status: 'unknown', backgroundShell: false }
  }
}

export function mapTaskNotificationStatus(raw: string | undefined): AgentStatus {
  switch (raw) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'error'
    case 'stopped':
      return 'cancelled'
    default:
      return 'unknown'
  }
}

export function mainAgentStatus(status: TerminalStatus): AgentStatus {
  switch (status) {
    case 'working':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'idle':
      return 'idle'
    case 'stale':
      return 'completed'
    case 'error':
      return 'error'
    default:
      return 'unknown'
  }
}

const TERMINAL_STATUSES: readonly string[] = ['working', 'waiting', 'idle', 'stale', 'error', 'unknown']
const AGENT_STATUSES: readonly string[] = ['working', 'waiting', 'idle', 'completed', 'error', 'cancelled', 'unknown']

export function normalizeTerminalStatus(value: unknown): TerminalStatus {
  return typeof value === 'string' && TERMINAL_STATUSES.includes(value) ? (value as TerminalStatus) : 'unknown'
}

export function normalizeAgentStatus(value: unknown): AgentStatus {
  return typeof value === 'string' && AGENT_STATUSES.includes(value) ? (value as AgentStatus) : 'unknown'
}

export function isAgentFinished(status: AgentStatus): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled'
}
