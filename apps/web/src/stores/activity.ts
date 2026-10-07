import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { ActivityEvent } from '@ccm/shared'

export const ACTIVITY_LIMIT = 300

export const useActivityStore = defineStore('activity', () => {
  const items = shallowRef<ActivityEvent[]>([])

  function replaceAll(list: ActivityEvent[]): void {
    items.value = [...list].reverse().slice(0, ACTIVITY_LIMIT)
  }

  function push(batch: ActivityEvent[]): void {
    if (batch.length === 0) return
    const seen = new Set(items.value.map((e) => e.id))
    const fresh = batch.filter((e) => !seen.has(e.id)).reverse()
    items.value = [...fresh, ...items.value].slice(0, ACTIVITY_LIMIT)
  }

  return { items, replaceAll, push }
})
