import type { ToolOutcome, ToolSpan } from '@ccm/shared'

export interface ToolRow {
  id: string
  tool: string
  start: string
  /** null while the call still runs. */
  ms: number | null
  state: 'running' | ToolOutcome
}

export const TOOL_ROWS = 30

/**
 * Newest calls first; names and times only, never the tool arguments.
 * A call the collector never closed on an agent that already finished was cut off, so it reads interrupted, not running.
 */
export function toolRows(spans: Iterable<ToolSpan>, agentId: string, agentLive: boolean, limit = TOOL_ROWS): { rows: ToolRow[]; older: number } {
  const mine: ToolSpan[] = []
  for (const s of spans) if (s.agentId === agentId) mine.push(s)
  mine.sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
  const rows = mine.slice(0, limit).map((s): ToolRow => {
    const start = Date.parse(s.start)
    const end = s.end ? Date.parse(s.end) : null
    const ms = end !== null && Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null
    return { id: s.id, tool: s.tool, start: s.start, ms, state: s.end ? (s.outcome ?? 'ok') : agentLive ? 'running' : 'interrupted' }
  })
  return { rows, older: Math.max(0, mine.length - rows.length) }
}
