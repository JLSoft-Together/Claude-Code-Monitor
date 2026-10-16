import type { Agent, TerminalStatus } from '@ccm/shared'

export const runningSubagents = (agents: readonly Pick<Agent, 'role' | 'status'>[] | undefined): number =>
  agents?.filter((a) => a.role === 'subagent' && (a.status === 'working' || a.status === 'waiting')).length ?? 0

export const effectiveStatus = (status: TerminalStatus, running: number): TerminalStatus => (status === 'idle' && running > 0 ? 'working' : status)
