<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { compactNumber, formatCost, formatDay, fullNumber } from '../../lib/format'
import { SERIES, useUsageStore, type SeriesKey } from '../../stores/usage'

defineProps<{ showTable: boolean }>()

const { t, locale } = useI18n()
const usage = useUsageStore()

const SERIES_FILL: Record<SeriesKey, string> = {
  input: 'fill-series-input',
  output: 'fill-series-output',
  cacheWrite: 'fill-series-write',
  cacheRead: 'fill-series-read',
}
const SERIES_BG: Record<SeriesKey, string> = {
  input: 'bg-series-input',
  output: 'bg-series-output',
  cacheWrite: 'bg-series-write',
  cacheRead: 'bg-series-read',
}

const HEIGHT = 200
const PAD = { top: 10, right: 30, bottom: 24, left: 56 }
const BAR_MAX = 28
const GAP = 2
const RADIUS = 4

const box = ref<HTMLElement | null>(null)
const width = ref(0)
const instant = ref(false)
const hover = ref<number | null>(null)
let observer: ResizeObserver | null = null
let settle = 0

onMounted(() => {
  if (!box.value) return
  width.value = Math.max(240, box.value.clientWidth)
  observer = new ResizeObserver(([entry]) => {
    if (!entry || !entry.contentRect.width) return
    const next = Math.max(240, Math.round(entry.contentRect.width))
    if (next === width.value) return
    instant.value = true
    width.value = next
    window.clearTimeout(settle)
    settle = window.setTimeout(() => (instant.value = false), 160)
  })
  observer.observe(box.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.clearTimeout(settle)
})

const fmt = (v: number) => (usage.metric === 'cost' ? formatCost(v, locale.value) : compactNumber(v))
const fmtFull = (v: number) => (usage.metric === 'cost' ? formatCost(v, locale.value) : fullNumber(Math.round(v), locale.value))

function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * mag
}

const innerH = HEIGHT - PAD.top - PAD.bottom
const baseline = PAD.top + innerH

const plot = computed(() => {
  const rows = usage.daily
  const innerW = Math.max(1, width.value - PAD.left - PAD.right)
  const max = niceMax(Math.max(0, ...rows.map((r) => r.total)))
  const slot = rows.length ? innerW / rows.length : innerW
  const bar = Math.max(2, Math.min(BAR_MAX, slot * 0.62))
  const px = (v: number) => (v / max) * innerH
  const ticks = [0, 0.5, 1].map((k) => ({ value: max * k, y: baseline - px(max * k) }))
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(innerW / 56))))
  const visible = usage.visibleSeries

  const columns = rows.map((row, i) => {
    const shown = visible.filter((k) => row.values[k] > 0)
    const topKey = shown.at(-1)
    let acc = 0
    const segments = SERIES.map((key) => {
      const on = shown.includes(key)
      const h = on ? px(row.values[key]) : 0
      const offset = acc
      acc += h
      const height = Math.max(0, h - (on && key !== topKey ? GAP : 0))
      return { key, offset, k: height / innerH }
    })
    return { row, cx: PAD.left + slot * i + slot / 2, segments, label: i % labelEvery === 0 || i === rows.length - 1 }
  })
  const avg = usage.range !== 'today' && usage.dailyAverage ? usage.dailyAverage : null
  return { columns, ticks, slot, bar, avgY: avg === null ? null : baseline - px(avg) }
})

const capClip = computed(() => {
  const r = Math.min(RADIUS, plot.value.bar / 2)
  return `inset(0 round ${r}px ${r}px 0 0)`
})

const hovered = computed(() => (hover.value === null ? null : (plot.value.columns[hover.value] ?? null)))
const tooltipLeft = computed(() => {
  const c = hovered.value
  if (!c) return 0
  return Math.min(Math.max(c.cx, 110), width.value - 110)
})

const summary = computed(() => {
  const rows = usage.daily
  const total = rows.reduce((s, r) => s + r.total, 0)
  const peak = rows.reduce((best, r) => (r.total > (best?.total ?? -1) ? r : best), rows[0])
  return t('usage.chartSummary', {
    days: rows.length,
    total: fmt(total),
    peak: peak ? formatDay(peak.day, locale.value, 'long') : '—',
  })
})

const dimmed = (day: string) => usage.selectedDay !== null && usage.selectedDay !== day

function onKey(e: KeyboardEvent): void {
  const n = plot.value.columns.length
  if (!n) return
  if (e.key === 'ArrowRight') hover.value = Math.min(n - 1, (hover.value ?? -1) + 1)
  else if (e.key === 'ArrowLeft') hover.value = Math.max(0, (hover.value ?? n) - 1)
  else if (e.key === 'Home') hover.value = 0
  else if (e.key === 'End') hover.value = n - 1
  else if ((e.key === 'Enter' || e.key === ' ') && hovered.value) usage.selectDay(hovered.value.row.day)
  else if (e.key === 'Escape' && hover.value !== null) hover.value = null
  else if (e.key === 'Escape' && usage.selectedDay !== null) usage.selectDay(null)
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="min-w-0">
    <div v-show="!showTable" ref="box" class="relative min-w-0" :style="{ height: `${HEIGHT}px` }">
      <svg
        v-if="width"
        :width="width"
        :height="HEIGHT"
        class="usage-chart block max-w-full outline-none"
        :data-instant="instant ? '' : undefined"
        role="img"
        tabindex="0"
        :aria-label="summary"
        :aria-description="t('usageV53.chartKeys')"
        @mouseleave="hover = null"
        @keydown="onKey"
        @blur="hover = null"
      >
        <g>
          <line
            v-for="(tick, ti) in plot.ticks"
            :key="`g${ti}`"
            :x1="PAD.left"
            :x2="width - PAD.right"
            :y1="tick.y"
            :y2="tick.y"
            :class="tick.value === 0 ? 'stroke-line-strong' : 'usage-gridline'"
            stroke-width="1"
          />
          <text
            v-for="(tick, ti) in plot.ticks"
            :key="`l${ti}`"
            :x="PAD.left - 8"
            :y="tick.y + 4"
            text-anchor="end"
            class="fill-ink-faint text-[11px] tabular-nums"
          >
            {{ fmt(tick.value) }}
          </text>
        </g>
        <g
          v-for="(col, i) in plot.columns"
          :key="col.row.day"
          class="usage-col"
          :style="{ transform: `translateX(${col.cx}px)` }"
        >
          <rect
            :x="-plot.slot / 2"
            :y="PAD.top"
            :width="plot.slot"
            :height="innerH"
            class="cursor-pointer transition-colors duration-(--ccm-dur-fast)"
            :class="usage.selectedDay === col.row.day ? 'fill-fill' : hover === i ? 'fill-raised' : 'fill-transparent'"
            @mouseenter="hover = i"
            @click="usage.selectDay(col.row.day)"
          />
          <g
            class="pointer-events-none transition-opacity duration-(--ccm-dur-fast) ease-out-quint"
            :class="dimmed(col.row.day) ? 'opacity-35' : 'opacity-100'"
            :style="{ clipPath: capClip }"
          >
            <g class="ccm-grow" :style="{ animationDelay: `${Math.min(i * 20, 600)}ms` }">
              <rect
                v-for="s in col.segments"
                :key="s.key"
                :x="-plot.bar / 2"
                :y="PAD.top"
                :width="plot.bar"
                :height="innerH"
                class="usage-seg"
                :class="SERIES_FILL[s.key]"
                :style="{ transform: `translateY(${-s.offset}px) scaleY(${s.k})` }"
              />
            </g>
          </g>
          <text
            v-if="col.label"
            :x="0"
            :y="baseline + 17"
            text-anchor="middle"
            class="pointer-events-none text-[11px] tabular-nums"
            :class="usage.selectedDay === col.row.day ? 'fill-ink font-semibold' : 'fill-ink-faint'"
          >
            {{ formatDay(col.row.day, locale) }}
          </text>
        </g>
        <Transition name="ccm-fade">
          <g v-if="plot.avgY !== null" class="usage-avg pointer-events-none" :style="{ transform: `translateY(${plot.avgY}px)` }">
            <line :x1="PAD.left" :x2="width - PAD.right" y1="0" y2="0" class="stroke-ink-faint" stroke-width="1" stroke-dasharray="3 3" />
            <text :x="width - PAD.right + 4" y="4" class="fill-ink-faint text-[10px] font-medium">{{ t('usageV53.avg') }}</text>
          </g>
        </Transition>
      </svg>

      <Transition
        enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
        enter-from-class="opacity-0 translate-y-1"
        leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
        leave-to-class="opacity-0"
      >
        <div
          v-if="hovered"
          class="pointer-events-none absolute top-0 z-10 w-[220px] -translate-x-1/2 rounded-card bg-surface p-3 text-xs shadow-pop"
          :style="{ left: `${tooltipLeft}px` }"
          role="status"
        >
          <p class="font-semibold text-ink">{{ formatDay(hovered.row.day, locale, 'long') }}</p>
          <dl class="mt-2 space-y-1">
            <div v-for="key in [...usage.visibleSeries].reverse()" :key="key" class="flex items-center gap-2">
              <dt class="flex flex-1 items-center gap-1.5 text-ink-muted">
                <span class="size-2 rounded-sm" :class="SERIES_BG[key]" aria-hidden="true" />{{ t(`usage.series.${key}`) }}
              </dt>
              <dd class="font-medium text-ink tabular-nums">{{ fmtFull(hovered.row.values[key]) }}</dd>
            </div>
            <div class="flex items-center gap-2 border-t border-line pt-1">
              <dt class="flex-1 text-ink-muted">{{ t('usage.total') }}</dt>
              <dd class="font-semibold text-ink tabular-nums">{{ fmtFull(hovered.row.total) }}</dd>
            </div>
          </dl>
          <p class="mt-2 text-2xs text-ink-faint">
            {{ usage.selectedDay === hovered.row.day ? t('usageV53.unpickHint') : t('usageV53.pickHint') }}
          </p>
        </div>
      </Transition>
    </div>

    <div v-if="showTable" class="overflow-auto rounded-lg border border-line" :style="{ maxHeight: `${HEIGHT}px` }">
      <table class="w-full min-w-[520px] text-left text-xs">
        <thead class="sticky top-0 bg-raised text-ink-muted">
          <tr>
            <th scope="col" class="px-3 py-2 font-medium">{{ t('usage.day') }}</th>
            <th v-for="key in usage.visibleSeries" :key="key" scope="col" class="px-3 py-2 text-right font-medium">{{ t(`usage.series.${key}`) }}</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">{{ t('usage.total') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="row in [...usage.daily].reverse()" :key="row.day" :class="usage.selectedDay === row.day ? 'bg-accent-soft' : ''">
            <th scope="row" class="px-1.5 py-0.5 font-normal">
              <button
                type="button"
                class="ccm-btn-plain min-h-6! justify-start px-1.5! text-xs"
                :class="usage.selectedDay === row.day ? 'font-medium text-accent-ink!' : 'text-ink!'"
                :aria-pressed="usage.selectedDay === row.day"
                :title="usage.selectedDay === row.day ? t('usageV53.unpickHint') : t('usageV53.pickHint')"
                @click="usage.selectDay(row.day)"
              >
                {{ formatDay(row.day, locale, 'long') }}
              </button>
            </th>
            <td v-for="key in usage.visibleSeries" :key="key" class="px-3 py-1.5 text-right tabular-nums">{{ fmtFull(row.values[key]) }}</td>
            <td class="px-3 py-1.5 text-right font-medium tabular-nums">{{ fmtFull(row.total) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.usage-gridline {
  stroke: var(--ccm-grid);
}

.usage-col {
  transition: transform var(--ccm-dur-slow) var(--ease-out-quint);
}

.usage-avg {
  transition:
    transform var(--ccm-dur-slow) var(--ease-out-quint),
    opacity var(--ccm-dur-base) var(--ease-out-quint);
}

.usage-avg.ccm-fade-leave-active {
  transition: opacity var(--ccm-dur-fast) var(--ease-exit);
}

.usage-seg {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  transition: transform var(--ccm-dur-slow) var(--ease-out-quint);
}

.usage-chart[data-instant] .usage-col,
.usage-chart[data-instant] .usage-avg,
.usage-chart[data-instant] .usage-seg {
  transition: none;
}
</style>
