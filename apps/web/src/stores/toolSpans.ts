import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { ToolSpan, ToolSpansData } from '@ccm/shared'

const KEEP_MS = 2 * 60 * 60_000
const PRUNE_EVERY_MS = 60_000

export const useToolSpansStore = defineStore('toolSpans', () => {
  const byTerminal = shallowRef(new Map<string, Map<string, ToolSpan>>())
  const version = ref(0)
  let pruneTimer: number | undefined

  function touch(): void {
    byTerminal.value = new Map(byTerminal.value)
    version.value++
    if (pruneTimer === undefined) pruneTimer = window.setInterval(() => prune(Date.now()), PRUNE_EVERY_MS)
  }

  function bucket(terminalId: string): Map<string, ToolSpan> {
    let map = byTerminal.value.get(terminalId)
    if (!map) {
      map = new Map()
      byTerminal.value.set(terminalId, map)
    }
    return map
  }

  function put(span: ToolSpan): void {
    const map = bucket(span.terminalId)
    const prev = map.get(span.id)
    if (prev?.end && !span.end) return
    map.set(span.id, span)
  }

  function upsert(span: ToolSpan): void {
    put(span)
    touch()
  }

  function applyData(data: ToolSpansData): void {
    const sinceMs = data.since ? Date.parse(data.since) : undefined
    const inRange = (s: ToolSpan): boolean => sinceMs === undefined || !s.end || Date.parse(s.end) >= sinceMs
    const scope = data.terminalId ? [data.terminalId] : [...byTerminal.value.keys()]
    const closed = new Map<string, ToolSpan>()
    for (const id of scope) {
      const map = byTerminal.value.get(id)
      if (!map) continue
      for (const [spanId, s] of map) {
        if (!inRange(s)) continue
        if (s.end) closed.set(spanId, s)
        map.delete(spanId)
      }
    }
    for (const s of data.spans) {
      const local = closed.get(s.id)
      put(local && !s.end ? local : s)
    }
    touch()
  }

  function removeTerminal(terminalId: string): void {
    if (byTerminal.value.delete(terminalId)) touch()
  }

  function prune(nowMs: number): void {
    let changed = false
    for (const map of byTerminal.value.values()) {
      for (const [id, s] of map) {
        if (s.end && Date.parse(s.end) < nowMs - KEEP_MS) {
          map.delete(id)
          changed = true
        }
      }
    }
    if (changed) touch()
  }

  function spansFor(terminalId?: string): ToolSpan[] {
    if (terminalId) return [...(byTerminal.value.get(terminalId)?.values() ?? [])]
    return [...byTerminal.value.values()].flatMap((m) => [...m.values()])
  }

  return { version, upsert, applyData, removeTerminal, prune, spansFor }
})
