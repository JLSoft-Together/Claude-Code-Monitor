import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { ActivityEvent } from '@ccm/shared'

export const ACTIVITY_LIMIT = 1000
export const TOOL_ACTIVITY_LIMIT = 500

const isTool = (e: ActivityEvent) => e.kind.startsWith('tool.')

/** Newest first; tool events have their own cap so they cannot push waits and completions out. */
function capped(list: ActivityEvent[]): ActivityEvent[] {
  let tools = 0
  let others = 0
  return list.filter((e) => (isTool(e) ? ++tools <= TOOL_ACTIVITY_LIMIT : ++others <= ACTIVITY_LIMIT))
}

export const useActivityStore = defineStore('activity', () => {
  const items = shallowRef<ActivityEvent[]>([])

  function replaceAll(list: ActivityEvent[]): void {
    items.value = capped([...list].reverse())
  }

  function push(batch: ActivityEvent[]): void {
    if (batch.length === 0) return
    const seen = new Set(items.value.map((e) => e.id))
    const fresh = batch.filter((e) => !seen.has(e.id)).reverse()
    items.value = capped([...fresh, ...items.value])
  }

  return { items, replaceAll, push }
})
