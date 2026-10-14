<script setup lang="ts">
import { computed } from 'vue'
import { clampLane, MAX_LANES, type GraphRow } from '../../../lib/commitGraph'

const props = defineProps<{ row: GraphRow; lanes: number; head?: boolean }>()
const LANE = 12
const H = 24
const PAD = 8
const x = (i: number): number => PAD + clampLane(i) * LANE
const colour = (c: number): string => `var(--ccm-model-${(c % 8) + 1})`
const width = computed(() => PAD * 2 + (Math.min(props.lanes, MAX_LANES) - 1) * LANE)
// Lanes past MAX_LANES share the last column, so many refs would otherwise draw the same edge over and over.
const paths = computed(() => {
  const seen = new Set<string>()
  return props.row.edges.flatMap((e) => {
    const y0 = e.half === 'top' ? 0 : H / 2
    const y1 = e.half === 'top' ? H / 2 : H
    const x0 = x(e.from)
    const x1 = x(e.to)
    const mid = (y0 + y1) / 2
    const key = `${x0}|${x1}|${e.half}|${e.color % 8}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ d: x0 === x1 ? `M${x0} ${y0}V${y1}` : `M${x0} ${y0}C${x0} ${mid} ${x1} ${mid} ${x1} ${y1}`, stroke: colour(e.color) }]
  })
})
</script>

<template>
  <svg :width="width" :height="H" class="shrink-0 overflow-visible" aria-hidden="true">
    <path v-for="(p, i) in paths" :key="i" :d="p.d" :stroke="p.stroke" stroke-width="1.5" fill="none" stroke-linecap="round" />
    <circle :cx="x(row.lane)" :cy="H / 2" r="3.5" :fill="head ? 'var(--ccm-surface)' : colour(row.color)" :stroke="colour(row.color)" stroke-width="1.5" />
  </svg>
</template>
