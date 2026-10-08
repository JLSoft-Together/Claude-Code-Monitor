import { defineStore } from 'pinia'
import { ref } from 'vue'
import { snoozedUntil, type SnoozeEntry, type TerminalSession } from '@ccm/shared'
import { useConnectionStore } from './connection'

export const SNOOZE_CHOICES = [15, 60] as const

export const useSnoozeStore = defineStore('snooze', () => {
  const entries = ref<Record<string, SnoozeEntry>>({})

  function replaceAll(next: Record<string, SnoozeEntry>): void {
    entries.value = { ...next }
  }

  function snooze(terminal: TerminalSession, minutes: number): boolean {
    if (!useConnectionStore().snoozeTerminal(terminal.id, minutes)) return false
    entries.value = { ...entries.value, [terminal.id]: { until: Date.now() + minutes * 60_000, since: terminal.statusSince } }
    return true
  }

  function clear(id: string): boolean {
    if (!entries.value[id] || !useConnectionStore().snoozeTerminal(id, null)) return false
    const next = { ...entries.value }
    delete next[id]
    entries.value = next
    return true
  }

  function until(terminal: TerminalSession | undefined, nowMs: number): number | null {
    return terminal ? snoozedUntil(entries.value[terminal.id], terminal, nowMs) : null
  }

  const isSnoozed = (terminal: TerminalSession | undefined, nowMs: number): boolean => until(terminal, nowMs) !== null

  return { entries, replaceAll, snooze, clear, until, isSnoozed }
})
