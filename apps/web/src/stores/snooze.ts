import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TerminalSession } from '@ccm/shared'

interface Entry {
  until: number
  /** The waiting episode it belongs to; a new wait starts unsnoozed. */
  since?: string
}

const KEY = 'ccm.snooze'
export const SNOOZE_CHOICES = [15, 60] as const

function load(): Record<string, Entry> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Partial<Entry>>
    const out: Record<string, Entry> = {}
    for (const [id, e] of Object.entries(raw)) {
      if (typeof e?.until === 'number' && e.until > Date.now()) out[id] = { until: e.until, since: typeof e.since === 'string' ? e.since : undefined }
    }
    return out
  } catch {
    return {}
  }
}

/** "Remind me later" for a waiting session: hides it from the badge and holds its notifications until the time is up. */
export const useSnoozeStore = defineStore('snooze', () => {
  const entries = ref<Record<string, Entry>>(load())

  function save(): void {
    const nowMs = Date.now()
    const kept: Record<string, Entry> = {}
    for (const [id, e] of Object.entries(entries.value)) if (e.until > nowMs) kept[id] = e
    entries.value = kept
    try {
      localStorage.setItem(KEY, JSON.stringify(kept))
    } catch {
      return
    }
  }

  function snooze(terminal: TerminalSession, minutes: number): void {
    entries.value = { ...entries.value, [terminal.id]: { until: Date.now() + minutes * 60_000, since: terminal.statusSince } }
    save()
  }

  function clear(id: string): void {
    if (!entries.value[id]) return
    const next = { ...entries.value }
    delete next[id]
    entries.value = next
    save()
  }

  function until(terminal: TerminalSession | undefined, nowMs: number): number | null {
    if (!terminal || terminal.status !== 'waiting') return null
    const e = entries.value[terminal.id]
    return e && e.until > nowMs && e.since === terminal.statusSince ? e.until : null
  }

  const isSnoozed = (terminal: TerminalSession | undefined, nowMs: number): boolean => until(terminal, nowMs) !== null

  return { entries, snooze, clear, until, isSnoozed }
})
