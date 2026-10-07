<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { compactNumber, formatCost, fullNumber } from '../../lib/format'
import { useCountUp } from '../../composables/useCountUp'
import { Minus, TrendingDown, TrendingUp } from 'lucide-vue-next'
import { cacheHitRate, change, useUsageStore } from '../../stores/usage'

const { t, locale } = useI18n()
const usage = useUsageStore()

const totals = toRef(usage, 'totals')
const all = computed(() => totals.value.input + totals.value.output + totals.value.cacheWrite + totals.value.cacheRead)

const shownAll = useCountUp(all)
const shownInput = useCountUp(computed(() => totals.value.input))
const shownOutput = useCountUp(computed(() => totals.value.output))
const shownWrite = useCountUp(computed(() => totals.value.cacheWrite))
const shownRead = useCountUp(computed(() => totals.value.cacheRead))
const shownCost = useCountUp(computed(() => totals.value.cost))

const share = (v: number) => (all.value > 0 ? `${((v / all.value) * 100).toFixed(v / all.value < 0.01 ? 2 : 1)}%` : '—')

const prevTotals = computed(() => usage.previous?.totals ?? null)
const prevAll = computed(() => (prevTotals.value ? prevTotals.value.input + prevTotals.value.output + prevTotals.value.cacheWrite + prevTotals.value.cacheRead : 0))

function trend(current: number, previous: number | undefined) {
  if (previous === undefined) return null
  const c = change(current, previous)
  if (c === null) return null
  const pct = Math.round(c * 100)
  return { pct, label: `${pct > 0 ? '+' : ''}${pct}%`, icon: pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus }
}
const vs = computed(() => t(`usage.vs.${usage.range}`))
const tokenTrend = computed(() => (prevTotals.value ? trend(all.value, prevAll.value) : null))
const costTrend = computed(() => (prevTotals.value ? trend(totals.value.cost, prevTotals.value.cost) : null))

const hit = computed(() => cacheHitRate(totals.value))
const prevHit = computed(() => (prevTotals.value ? cacheHitRate(prevTotals.value) : null))
const hitLabel = computed(() => (hit.value === null ? '—' : `${Math.round(hit.value * 100)}%`))
const hitDelta = computed(() => {
  if (hit.value === null || prevHit.value === null) return null
  const pts = Math.round((hit.value - prevHit.value) * 100)
  return pts ? t('usage.hitDelta', { pts: `${pts > 0 ? '+' : ''}${pts}` }) : null
})

const tiles = computed(() => [
  { key: 'input', label: t('usage.series.input'), value: shownInput.value, raw: totals.value.input, dot: 'bg-series-input', note: share(totals.value.input) },
  { key: 'output', label: t('usage.series.output'), value: shownOutput.value, raw: totals.value.output, dot: 'bg-series-output', note: share(totals.value.output) },
  { key: 'cacheWrite', label: t('usage.series.cacheWrite'), value: shownWrite.value, raw: totals.value.cacheWrite, dot: 'bg-series-write', note: share(totals.value.cacheWrite) },
  { key: 'cacheRead', label: t('usage.series.cacheRead'), value: shownRead.value, raw: totals.value.cacheRead, dot: 'bg-series-read', note: share(totals.value.cacheRead) },
])
</script>

<template>
  <div>
  <div class="grid grid-cols-2 gap-3 xl:grid-cols-6">
    <div class="col-span-2 min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <p class="text-sm text-ink-muted">{{ t('usage.totalTokens') }}</p>
      <p class="mt-1 truncate text-4xl font-semibold tracking-tight text-ink" :title="fullNumber(all, locale)">
        {{ compactNumber(shownAll) }}
      </p>
      <p class="mt-2 text-xs text-ink-muted tabular">
        {{ t('usage.messages', { n: fullNumber(totals.messages, locale) }) }} · {{ t('usage.modelCount', { n: usage.byModel.length }) }}
      </p>
      <p v-if="tokenTrend" class="mt-1.5 inline-flex items-center gap-1 text-xs text-ink-muted tabular" :title="t('usage.vsTitle', { from: usage.previous?.from, to: usage.previous?.to })">
        <component :is="tokenTrend.icon" :size="14" aria-hidden="true" /><span class="font-semibold text-ink">{{ tokenTrend.label }}</span> {{ vs }}
      </p>
    </div>

    <div v-for="tile in tiles" :key="tile.key" class="min-w-0 rounded-2xl border border-line bg-surface p-4">
      <p class="flex items-center gap-1.5 truncate text-sm text-ink-muted">
        <span class="size-2.5 shrink-0 rounded-sm" :class="tile.dot" aria-hidden="true" />{{ tile.label }}
      </p>
      <p class="mt-1 truncate text-2xl font-semibold tracking-tight text-ink" :title="fullNumber(tile.raw, locale)">
        {{ compactNumber(tile.value) }}
      </p>
      <p class="mt-1 text-xs text-ink-faint tabular">{{ t('usage.share', { pct: tile.note }) }}</p>
    </div>
  </div>

  <div class="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-3 sm:px-5">
    <p class="text-sm text-ink-muted">{{ t('usage.estimatedCost') }}</p>
    <p class="text-2xl font-semibold tracking-tight text-ink tabular" :title="formatCost(totals.cost, locale)">{{ formatCost(shownCost, locale) }}</p>
    <p v-if="costTrend" class="inline-flex items-center gap-1 text-xs text-ink-muted tabular" :title="t('usage.vsTitle', { from: usage.previous?.from, to: usage.previous?.to })">
      <component :is="costTrend.icon" :size="14" aria-hidden="true" /><span class="font-semibold text-ink">{{ costTrend.label }}</span> {{ vs }}
    </p>
    <p class="text-xs text-ink-faint">
      {{ t('usage.costNote') }}<template v-if="totals.unpriced > 0"> · {{ t('usage.unpriced', { n: totals.unpriced }) }}</template>
    </p>
    <p class="ml-auto inline-flex items-baseline gap-1.5 text-sm text-ink-muted" :title="t('usage.hitTitle')">
      {{ t('usage.hitRate') }} <span class="text-lg font-semibold text-ink tabular">{{ hitLabel }}</span>
      <span v-if="hitDelta" class="text-xs text-ink-faint tabular">{{ hitDelta }}</span>
    </p>
  </div>
  </div>
</template>
