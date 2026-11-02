import type { Agent } from '@ccm/shared'

export interface SubagentTally {
  total: number
  done: number
  running: number
  error: number
  /** idle, unknown, cancelled: counted in the total, drawn as the grey remainder. */
  other: number
}

/** Running covers working and waiting subagents: both are still alive. */
export function tallySubagents(agents: readonly Pick<Agent, 'role' | 'status'>[]): SubagentTally {
  const out: SubagentTally = { total: 0, done: 0, running: 0, error: 0, other: 0 }
  for (const a of agents) {
    if (a.role !== 'subagent') continue
    out.total++
    if (a.status === 'completed') out.done++
    else if (a.status === 'working' || a.status === 'waiting') out.running++
    else if (a.status === 'error') out.error++
    else out.other++
  }
  return out
}
