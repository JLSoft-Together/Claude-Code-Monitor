<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { heatGrid, heatLevel } from '../../lib/heatmap'
import { useHistoryStore } from '../../stores/history'

const { t, tm, locale } = useI18n()
const history = useHistoryStore()

const grid = computed(() => heatGrid(history.heatmap))
// Monday-first labels from the Sunday-first clock.days list.
const weekdays = computed(() => {
  const days = (tm('clock.days') as string[]).map(String)
  return [...days.slice(1), days[0]!]
})
const hourLabel = (h: number): string => new Intl.DateTimeFormat(locale.value, { hour: 'numeric', hour12: false }).format(new Date(2000, 0, 1, h))
const LEVEL = ['bg-fill', 'ccm-heat-1', 'ccm-heat-2', 'ccm-heat-3', 'ccm-heat-4'] as const
const cellTitle = (weekday: number, hour: number, n: number): string =>
  t('history.heatmap.cell', { day: weekdays.value[weekday], hour: hourLabel(hour), n }, n)
const peakText = computed(() => {
  const p = grid.value.peak
  return p ? t('history.heatmap.peak', { day: weekdays.value[p.weekday], hour: hourLabel(p.hour) }) : ''
})
</script>

<template>
  <div>
    <p v-if="!history.heatmap" class="text-xs text-ink-muted" role="status">{{ t('history.heatmap.loading') }}</p>
    <p v-else-if="!grid.total" class="text-xs text-ink-muted">{{ t('history.heatmap.empty') }}</p>
    <template v-else>
      <div class="ccm-scroll overflow-x-auto">
        <table class="border-separate border-spacing-[3px] text-2xs text-ink-faint" :aria-label="t('history.heatmap.title')">
          <thead>
            <tr>
              <th scope="col" class="w-8" />
              <th v-for="h in 24" :key="h" scope="col" class="w-4 text-center font-normal">{{ (h - 1) % 3 === 0 ? hourLabel(h - 1) : '' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, d) in grid.rows" :key="d">
              <th scope="row" class="pr-1 text-left font-normal">{{ weekdays[d] }}</th>
              <td v-for="(n, h) in row" :key="h" class="size-4 rounded-[3px] p-0" :class="LEVEL[heatLevel(n, grid.max)]" :title="cellTitle(d, h, n)">
                <span class="sr-only">{{ cellTitle(d, h, n) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-muted">
        <span>{{ peakText }}</span>
        <span class="flex items-center gap-1" aria-hidden="true">
          {{ t('history.heatmap.less') }}
          <span v-for="l in 5" :key="l" class="size-3 rounded-[3px]" :class="LEVEL[l - 1]" />
          {{ t('history.heatmap.more') }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ccm-heat-1 {
  background: color-mix(in oklab, var(--ccm-accent) 25%, var(--ccm-fill));
}
.ccm-heat-2 {
  background: color-mix(in oklab, var(--ccm-accent) 50%, var(--ccm-fill));
}
.ccm-heat-3 {
  background: color-mix(in oklab, var(--ccm-accent) 75%, var(--ccm-fill));
}
.ccm-heat-4 {
  background: var(--ccm-accent);
}
</style>
