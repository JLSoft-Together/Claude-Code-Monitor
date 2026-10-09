import type { ToolOutcome, ToolSpan } from '@ccm/shared'
import type { Signal } from './transcript.js'

export const SPAN_LIMIT = 2000
export const SPAN_RETENTION_MS = 7_200_000
export const MAX_TOOL_NAME = 80

export class ToolSpanLog {
  private spans = new Map<string, ToolSpan>()

  constructor(
    private terminalId: string,
    private now: () => number = Date.now,
  ) {}

  apply(signals: Signal[], agentId: string): ToolSpan[] {
    const changed: ToolSpan[] = []
    for (const s of signals) {
      if (s.k === 'tool_use') {
        if (!s.at || Number.isNaN(Date.parse(s.at)) || this.spans.has(s.id)) continue
        const span: ToolSpan = { id: s.id, terminalId: this.terminalId, agentId, tool: s.name.slice(0, MAX_TOOL_NAME), start: s.at }
        this.spans.set(s.id, span)
        changed.push({ ...span })
      } else if (s.k === 'tool_result') {
        const span = this.spans.get(s.toolUseId)
        if (span && !span.end && s.at && this.close(span, s.at, s.isError ? 'error' : 'ok')) changed.push({ ...span })
      } else if (s.k === 'turn_end' && s.at) {
        for (const span of this.spans.values()) {
          if (span.agentId === agentId && !span.end && this.close(span, s.at, 'interrupted')) changed.push({ ...span })
        }
      }
    }
    this.prune()
    return changed
  }

  closeOpen(at: string, agentId?: string): ToolSpan[] {
    const changed: ToolSpan[] = []
    for (const span of this.spans.values()) {
      if (span.end || (agentId !== undefined && span.agentId !== agentId)) continue
      if (this.close(span, at, 'interrupted')) changed.push({ ...span })
    }
    return changed
  }

  list(sinceMs?: number): ToolSpan[] {
    this.prune()
    const out: ToolSpan[] = []
    for (const span of this.spans.values()) {
      if (sinceMs !== undefined && span.end && Date.parse(span.end) < sinceMs) continue
      out.push({ ...span })
    }
    return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  }

  private close(span: ToolSpan, at: string, outcome: ToolOutcome): boolean {
    const t = Date.parse(at)
    if (Number.isNaN(t)) return false
    span.end = t < Date.parse(span.start) ? span.start : at
    span.outcome = outcome
    return true
  }

  private prune() {
    const cutoff = this.now() - SPAN_RETENTION_MS
    for (const [id, span] of this.spans) if (span.end && Date.parse(span.end) < cutoff) this.spans.delete(id)
    for (const [id, span] of this.spans) {
      if (this.spans.size <= SPAN_LIMIT) break
      if (span.end) this.spans.delete(id)
    }
  }
}
