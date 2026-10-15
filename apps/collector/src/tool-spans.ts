import type { ToolOutcome, ToolSpan } from '@ccm/shared'
import type { Signal } from './transcript.js'

export const SPAN_LIMIT = 2000
export const SPAN_RETENTION_MS = 7_200_000
export const MAX_TOOL_NAME = 80
const PRUNE_SLACK = 64

interface Entry {
  span: ToolSpan
  startMs: number
  endMs?: number
}

export class ToolSpanLog {
  private spans = new Map<string, Entry>()

  constructor(
    private terminalId: string,
    private now: () => number = Date.now,
  ) {}

  /** Callers prune once per sync; apply() trims only past a small slack over the cap, so a catch-up stays linear. */
  apply(signals: Signal[], agentId: string): ToolSpan[] {
    const changed: ToolSpan[] = []
    for (const s of signals) {
      if (s.k === 'tool_use') {
        if (!s.at || this.spans.has(s.id)) continue
        const startMs = Date.parse(s.at)
        if (Number.isNaN(startMs)) continue
        const span: ToolSpan = { id: s.id, terminalId: this.terminalId, agentId, tool: s.name.slice(0, MAX_TOOL_NAME), start: s.at }
        this.spans.set(s.id, { span, startMs })
        changed.push({ ...span })
      } else if (s.k === 'tool_result') {
        const entry = this.spans.get(s.toolUseId)
        if (entry && entry.endMs === undefined && s.at && this.close(entry, s.at, s.isError ? 'error' : 'ok')) changed.push({ ...entry.span })
      } else if (s.k === 'turn_end' && s.at) {
        for (const entry of this.spans.values()) {
          if (entry.span.agentId === agentId && entry.endMs === undefined && this.close(entry, s.at, 'interrupted')) changed.push({ ...entry.span })
        }
      }
    }
    if (this.spans.size > SPAN_LIMIT + PRUNE_SLACK) this.prune()
    return changed
  }

  closeOpen(at: string, agentId?: string): ToolSpan[] {
    const changed: ToolSpan[] = []
    for (const entry of this.spans.values()) {
      if (entry.endMs !== undefined || (agentId !== undefined && entry.span.agentId !== agentId)) continue
      if (this.close(entry, at, 'interrupted')) changed.push({ ...entry.span })
    }
    return changed
  }

  list(sinceMs?: number): ToolSpan[] {
    this.prune()
    const out: Entry[] = []
    for (const entry of this.spans.values()) {
      if (sinceMs !== undefined && entry.endMs !== undefined && entry.endMs < sinceMs) continue
      out.push(entry)
    }
    return out.sort((a, b) => a.startMs - b.startMs).map((e) => ({ ...e.span }))
  }

  prune(): void {
    const cutoff = this.now() - SPAN_RETENTION_MS
    for (const [id, entry] of this.spans) if (entry.endMs !== undefined && entry.endMs < cutoff) this.spans.delete(id)
    for (const [id, entry] of this.spans) {
      if (this.spans.size <= SPAN_LIMIT) break
      if (entry.endMs !== undefined) this.spans.delete(id)
    }
  }

  private close(entry: Entry, at: string, outcome: ToolOutcome): boolean {
    const t = Date.parse(at)
    if (Number.isNaN(t)) return false
    const early = t < entry.startMs
    entry.span.end = early ? entry.span.start : at
    entry.endMs = early ? entry.startMs : t
    entry.span.outcome = outcome
    return true
  }
}
