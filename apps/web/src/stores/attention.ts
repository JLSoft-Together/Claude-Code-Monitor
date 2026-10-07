import { defineStore } from 'pinia'
import { computed } from 'vue'
import { errorLoops } from '../lib/attention'
import { sessionConflicts } from '../lib/conflicts'
import { now } from '../lib/format'
import { useActivityStore } from './activity'
import { useTerminalsStore } from './terminals'
import { useUsageStore } from './usage'

/** Derived warnings shared by cards, notifications and the away summary. */
export const useAttentionStore = defineStore('attention', () => {
  const activity = useActivityStore()
  const terminals = useTerminalsStore()
  const usage = useUsageStore()

  // Ten-second resolution is plenty for a five-minute window and keeps the scan off the 1 s clock.
  const tick = computed(() => Math.floor(now.value / 10_000))
  const loops = computed(() => errorLoops(activity.items, tick.value * 10_000 + 9_999))
  const conflicts = computed(() => sessionConflicts(terminals.live, (cwd) => usage.roots[cwd] ?? cwd))

  return { loops, conflicts }
})
