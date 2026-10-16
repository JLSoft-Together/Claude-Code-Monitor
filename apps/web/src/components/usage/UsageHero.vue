<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChartColumnBig, Minus, Table2, TrendingDown, TrendingUp, X } from 'lucide-vue-next'
import { PRICING_CHECKED_AT } from '@ccm/shared'
import { compactNumber, formatCost, formatDay, fullNumber } from '../../lib/format'
import { cacheHitRate, change, SERIES, useUsageStore, type SeriesKey } from '../../stores/usage'
import { useExtrasStore } from '../../stores/extras'
import CountNum from '../CountNum.vue'
import UsageDailyChart from './UsageDailyChart.vue'
import UsageInfo from './UsageInfo.vue'
import UsageLimits from './UsageLimits.vue'

const { t, locale } = useI18n()
const usage = useUsageStore()
const extras = useExtrasStore()

const SERIES_BG: Record<SeriesKey, string> = {
  input: 'bg-series-input',
  output: 'bg-series-output',
  cacheWrite: 'bg-series-write',
  cacheRead: 'bg-series-read',
}
const SERIES_RING: Record<SeriesKey, string> = {
  input: 'border-series-input',
  output: 'border-series-output',
  cacheWrite: 'border-series-write',
  cacheRead: 'border-series-read',
}

const showTable = ref(false)
const cost = computed(() => usage.metric === 'cost')
const fmt = computed(() => (cost.value ? (v: number) => formatCost(v, locale.value) : (v: number) => compactNumber(v)))
const exact = (v: number) => (cost.value ? formatCost(v, locale.value) : fullNumber(Math.round(v), locale.value))
const percent = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }))
const pct = (k: number) => (k > 0 && k < 0.01 ? `<${percent.value.format(0.01)}` : percent.value.format(k))

const hasLimits = computed(() => [extras.limits, extras.codexLimits].some((l) => !!(l?.fiveHour || l?.sevenDay)))

const scope = computed(() => (usage.selectedDay ? formatDay(usage.selectedDay, locale.value, 'long') : t(`usage.range.${usage.range}`)))

const average = computed(() => (usage.selectedDay === null && usage.range !== 'today' && usage.dailyAverage !== null ? t('usageV53.avgPerDay', { value: fmt.value(usage.dailyAverage) }) : null))

const trend = computed(() => {
  const prev = usage.previous
  if (usage.selectedDay !== null || !prev) return null
  const c = change(usage.heroTotal, prev.value)
  if (c === null) return null
  const p = Math.round(c * 100)
  return {
    label: `${p > 0 ? '+' : ''}${p}%`,
    icon: p > 0 ? TrendingUp : p < 0 ? TrendingDown : Minus,
    vs: t(`usage.vs.${usage.range}`),
    title: t('usage.vsTitle', { from: formatDay(prev.from, locale.value, 'long'), to: formatDay(prev.to, locale.value, 'long') }),
  }
})

const excluding = computed(() => (usage.hidden.length ? t('usageV53.excluding', { list: usage.hidden.map((k) => t(`usage.series.${k}`)).join(', ') }) : null))
const unpriced = computed(() => (cost.value && usage.totals.unpriced > 0 ? t('usage.unpriced', { n: usage.totals.unpriced }) : null))
const footnote = computed(() => t('usage.footnote', { date: PRICING_CHECKED_AT }))

const allSeries = computed(() => SERIES.reduce((s, k) => s + usage.seriesTotals[k], 0))
const hit = computed(() => cacheHitRate(usage.totals))
const legend = computed(() =>
  SERIES.map((key) => {
    const value = usage.seriesTotals[key]
    return {
      key,
      on: !usage.hidden.includes(key),
      name: t(`usage.series.${key}`),
      value,
      share: allSeries.value > 0 ? pct(value / allSeries.value) : '—',
      extra: key === 'cacheRead' && hit.value !== null ? t('usageV53.cacheRate', { pct: pct(hit.value) }) : null,
    }
  }),
)

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || usage.selectedDay === null) return
  if (document.querySelector('[aria-modal="true"]')) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"]')) return
  usage.selectDay(null)
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <section
    class="grid min-w-0 rounded-card bg-surface shadow-card"
    :class="hasLimits ? 'min-[900px]:grid-cols-[minmax(0,1fr)_15rem]' : ''"
    aria-labelledby="usage-hero-title"
  >
    <div class="min-w-0 p-4 sm:p-5">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex min-h-6 items-center gap-1">
            <p id="usage-hero-title" class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-ink-muted" aria-live="polite">
              <span>{{ t(`usageV53.measure.${usage.metric}`) }}</span>
              <span aria-hidden="true">·</span>
              <Transition name="ccm-fade" mode="out-in">
                <span :key="scope" :class="usage.selectedDay ? 'font-medium text-ink' : ''">{{ scope }}</span>
              </Transition>
              <span v-if="usage.selectedDay" class="sr-only">{{ t('usageV53.showingDay', { day: scope }) }}</span>
            </p>
            <Transition name="ccm-fade">
              <button
                v-if="usage.selectedDay"
                type="button"
                class="ccm-btn-plain min-h-6! min-w-6! px-0!"
                :aria-label="t('usageV53.showRange')"
                :title="t('usageV53.showRange')"
                @click="usage.selectDay(null)"
              >
                <X :size="14" aria-hidden="true" />
              </button>
            </Transition>
          </div>
          <div class="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p class="flex items-center gap-1 text-4xl leading-tight font-semibold tracking-tight text-ink" :title="exact(usage.heroTotal)">
              <Transition name="ccm-fade" mode="out-in">
                <CountNum :key="usage.metric" :value="usage.heroTotal" :format="fmt" />
              </Transition>
              <UsageInfo v-if="cost" class="ml-0.5 self-center" :label="t('usageV53.costInfo')" :text="footnote" />
            </p>
            <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted tabular">
              <span v-if="average">{{ average }}</span>
              <span v-if="trend" class="inline-flex items-center gap-1" :title="trend.title">
                <component :is="trend.icon" :size="14" aria-hidden="true" /><span class="font-semibold text-ink">{{ trend.label }}</span> {{ trend.vs }}
              </span>
              <span v-if="excluding" class="text-ink-faint">{{ excluding }}</span>
              <span v-if="unpriced" class="text-ink-faint">{{ unpriced }}</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          class="ccm-btn-plain shrink-0"
          :aria-pressed="showTable"
          :aria-label="showTable ? t('usage.showChart') : t('usage.showTable')"
          :title="showTable ? t('usage.showChart') : t('usage.showTable')"
          @click="showTable = !showTable"
        >
          <component :is="showTable ? ChartColumnBig : Table2" :size="16" aria-hidden="true" />
        </button>
      </div>

      <UsageDailyChart class="mt-3" :show-table="showTable" />

      <div class="mt-3 flex flex-wrap gap-1" role="group" :aria-label="t('usageV53.legend')">
        <button
          v-for="item in legend"
          :key="item.key"
          type="button"
          class="flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-control px-2.5 py-1.5 text-left transition-colors duration-(--ccm-dur-fast) hover:bg-fill"
          :aria-pressed="item.on"
          :title="`${t('usageV53.legendHint', { name: item.name })}\n${t(`usageV53.shareTitle.${usage.metric}`)}: ${item.share}`"
          @click="usage.toggleSeries(item.key)"
        >
          <span class="flex items-center gap-1.5 text-xs text-ink-muted">
            <span
              class="size-2.5 shrink-0 rounded-sm border-[1.5px] transition-colors duration-(--ccm-dur-fast)"
              :class="[SERIES_RING[item.key], item.on ? SERIES_BG[item.key] : 'bg-transparent']"
              aria-hidden="true"
            />{{ item.name }}
          </span>
          <span class="flex items-baseline gap-1.5 tabular">
            <span class="text-sm font-semibold transition-colors duration-(--ccm-dur-fast)" :class="item.on ? 'text-ink' : 'text-ink-faint'">
              <CountNum :key="usage.metric" :value="item.value" :format="fmt" />
            </span>
            <span class="text-2xs text-ink-faint">{{ item.share }}</span>
            <span v-if="item.extra" class="text-2xs text-ink-faint">· {{ item.extra }}</span>
          </span>
        </button>
      </div>
    </div>

    <Transition name="ccm-fade">
      <aside v-if="hasLimits" class="min-w-0 border-t border-line p-4 sm:p-5 min-[900px]:border-t-0 min-[900px]:border-l">
        <UsageLimits />
      </aside>
    </Transition>
  </section>
</template>
