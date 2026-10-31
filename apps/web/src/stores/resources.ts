import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ResourceReport, SessionRes } from '@ccm/shared'
import type { ResTab } from '../lib/resources'

/** Latest process sample from the collector (v76): sessions, servers, daemons, ports, port conflicts. */
export const useResourcesStore = defineStore('resources', () => {
  const report = shallowRef<ResourceReport | null>(null)
  const open = ref(false)
  const tab = ref<ResTab>('sessions')
  const onlyForgotten = ref(false)
  /** Port row to scroll to and highlight when the dialog opens from a conflict notice. */
  const focusPort = ref<number | null>(null)
  const dismissedConflicts = ref<Set<string>>(new Set())

  function set(next: ResourceReport | null | undefined): void {
    report.value = next && Array.isArray(next.sessions) && Array.isArray(next.servers) ? next : null
  }

  const forgotten = computed(() => report.value?.totals.forgotten ?? 0)

  const bySession = computed(() => {
    const map = new Map<string, SessionRes>()
    for (const s of report.value?.sessions ?? []) map.set(s.sessionId, s)
    return map
  })

  const conflictKey = (c: { sessionId: string; port: number; at: number }): string => `${c.sessionId}|${c.port}|${c.at}`
  const conflicts = computed(() => (report.value?.conflicts ?? []).filter((c) => !dismissedConflicts.value.has(conflictKey(c))))

  function dismissConflict(c: { sessionId: string; port: number; at: number }): void {
    dismissedConflicts.value = new Set([...dismissedConflicts.value, conflictKey(c)])
  }

  function show(at: ResTab = tab.value, port: number | null = null): void {
    tab.value = at
    focusPort.value = port
    if (port !== null) onlyForgotten.value = false
    open.value = true
  }

  return { report, open, tab, onlyForgotten, focusPort, forgotten, bySession, conflicts, set, show, dismissConflict }
})
