import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { DayTimeline, SessionRecord } from '@ccm/shared'

export const useHistoryStore = defineStore('history', () => {
  const sessions = shallowRef<SessionRecord[]>([])
  const loaded = ref(false)
  const timeline = shallowRef<DayTimeline | null>(null)

  function setSessions(list: SessionRecord[]): void {
    sessions.value = list
    loaded.value = true
  }

  function add(record: SessionRecord): void {
    if (!loaded.value) return
    sessions.value = [record, ...sessions.value.filter((r) => r.id !== record.id)]
  }

  /** A new snapshot means events may have been missed; the next view refetches. */
  function invalidate(): void {
    loaded.value = false
  }

  function setTimeline(value: DayTimeline): void {
    timeline.value = value
  }

  return { sessions, loaded, timeline, setSessions, add, invalidate, setTimeline }
})
