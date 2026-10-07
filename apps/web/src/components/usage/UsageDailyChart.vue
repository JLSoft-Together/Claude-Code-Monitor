<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChartColumnBig, Table2 } from 'lucide-vue-next'
import { compactNumber, formatCost, formatDay, fullNumber } from '../../lib/format'
import { SERIES, useUsageStore, type SeriesKey } from '../../stores/usage'

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

const HEIGHT = 260
const PAD = { top: 12, right: 8, bottom: 28, left: 56 }
const BAR_MAX = 24
const GAP = 2

const box = ref<HTMLElement | null>(null)
const width = ref(640)
const showTable = ref(false)
const hover = ref<number | null>(null)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!box.value) return
  width.value = box.value.clientWidth
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = Math.max(240, entry.contentRect.width)
  })
  observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

const fmt = (v: number) => (usage.metric === 'cost' ? formatCost(v, locale.value) : compactNumber(v))
const fmtFull = (v: number) => (usage.metric === 'cost' ? formatCost(v, locale.value) : fullNumber(Math.round(v), locale.value))

function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * mag
}

const plot = computed(() => {
  const rows = usage.daily
  const innerW = width.value - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const max = niceMax(Math.max(0, ...rows.map((r) => r.total)))
  const slot = rows.length ? innerW / rows.length : innerW
  const bar = Math.max(2, Math.min(BAR_MAX, slot * 0.62))
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => ({ value: max * k, y: y(max * k) }))
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(innerW / 64))))

  const columns = rows.map((row, i) => {
    const cx = PAD.left + slot * i + slot / 2
    let acc = 0
    const segments: { key: SeriesKey; x: number; y: number; w: number; h: number; top: boolean }[] = []
    const visible = usage.visibleSeries.filter((k) => row.values[k] > 0)
    visible.forEach((key, idx) => {
      const v = row.values[key]
      const y0 = y(acc)
      acc += v
      const y1 = y(acc)
      const top = idx === visible.length - 1
      const h = Math.max(0, y0 - y1 - (top ? 0 : GAP))
      segments.push({ key, x: cx - bar / 2, y: y1 + (top ? 0 : GAP), w: bar, h, top })
    })
    return { row, cx, segments, label: i % labelEvery === 0 || i === rows.length - 1 }
  })
  return { columns, ticks, slot, innerH, baseline: y(0) }
})

/** Data-end rounded 4px, square at the baseline. */
function segmentPath(s: { x: number; y: number; w: number; h: number; top: boolean }): string {
  const r = s.top ? Math.min(4, s.w / 2, s.h) : 0
  const { x, y, w, h } = s
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

const hovered = computed(() => (hover.value === null ? null : plot.value.columns[hover.value] ?? null))
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

function onKey(e: KeyboardEvent): void {
  const n = plot.value.columns.length
  if (!n) return
  if (e.key === 'ArrowRight') hover.value = Math.min(n - 1, (hover.value ?? -1) + 1)
  else if (e.key === 'ArrowLeft') hover.value = Math.max(0, (hover.value ?? n) - 1)
  else if (e.key === 'Escape') hover.value = null
  else return
  e.preventDefault()
}
</script>

<template>
  <section class="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="usage-daily-title">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 id="usage-daily-title" class="text-base font-semibold">{{ t('usage.daily') }}</h3>
        <p class="mt-0.5 text-xs text-ink-muted">{{ summary }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="key in SERIES"
          :key="key"
          type="button"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors"
          :class="usage.hidden.includes(key) ? 'border-line text-ink-faint' : 'border-line-strong text-ink'"
          :aria-pressed="!usage.hidden.includes(key)"
          :title="t('usage.toggleSeries')"
          @click="usage.toggleSeries(key)"
        >
          <span
            class="size-2.5 rounded-sm transition-opacity"
            :class="[SERIES_BG[key], usage.hidden.includes(key) ? 'opacity-30' : '']"
            aria-hidden="true"
          />
          {{ t(`usage.series.${key}`) }}
        </button>
        <button
          type="button"
          class="ml-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-pressed="showTable"
          :aria-label="showTable ? t('usage.showChart') : t('usage.showTable')"
          :title="showTable ? t('usage.showChart') : t('usage.showTable')"
          @click="showTable = !showTable"
        >
          <component :is="showTable ? ChartColumnBig : Table2" :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-show="!showTable" ref="box" class="relative mt-4 min-w-0">
      <svg
        :width="width"
        :height="HEIGHT"
        class="block max-w-full outline-none"
        role="img"
        tabindex="0"
        :aria-label="summary"
        @mouseleave="hover = null"
        @keydown="onKey"
        @blur="hover = null"
      >
        <g>
          <line
            v-for="tick in plot.ticks"
            :key="tick.value"
            :x1="56"
            :x2="width - 8"
            :y1="tick.y"
            :y2="tick.y"
            :stroke="tick.value === 0 ? 'var(--ccm-line-strong)' : 'var(--ccm-grid)'"
            stroke-width="1"
          />
          <text
            v-for="tick in plot.ticks"
            :key="`l${tick.value}`"
            :x="48"
            :y="tick.y + 4"
            text-anchor="end"
            class="fill-ink-faint text-[11px] tabular-nums"
          >
            {{ fmt(tick.value) }}
          </text>
        </g>
        <g v-for="(col, i) in plot.columns" :key="col.row.day">
          <rect
            :x="col.cx - plot.slot / 2"
            :y="12"
            :width="plot.slot"
            :height="plot.innerH"
            :class="hover === i ? 'fill-raised' : 'fill-transparent'"
            @mouseenter="hover = i"
          />
          <path
            v-for="(s, si) in col.segments"
            :key="s.key"
            :d="segmentPath(s)"
            :class="[SERIES_FILL[s.key], 'ccm-grow pointer-events-none']"
            :style="{ animationDelay: `${Math.min(i * 18 + si * 30, 600)}ms` }"
          />
          <text
            v-if="col.label"
            :x="col.cx"
            :y="plot.baseline + 18"
            text-anchor="middle"
            class="pointer-events-none fill-ink-faint text-[11px] tabular-nums"
          >
            {{ formatDay(col.row.day, locale) }}
          </text>
        </g>
      </svg>

      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 translate-y-1"
        leave-active-class="transition duration-100 ease-in"
        leave-to-class="opacity-0"
      >
        <div
          v-if="hovered"
          class="pointer-events-none absolute top-0 z-10 w-[220px] -translate-x-1/2 rounded-xl border border-line-strong bg-surface p-3 text-xs shadow-lg shadow-black/10"
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
        </div>
      </Transition>
    </div>

    <div v-if="showTable" class="mt-4 max-h-[320px] overflow-auto rounded-lg border border-line">
      <table class="w-full min-w-[520px] text-left text-xs">
        <thead class="sticky top-0 bg-raised text-ink-muted">
          <tr>
            <th scope="col" class="px-3 py-2 font-medium">{{ t('usage.day') }}</th>
            <th v-for="key in usage.visibleSeries" :key="key" scope="col" class="px-3 py-2 text-right font-medium">{{ t(`usage.series.${key}`) }}</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">{{ t('usage.total') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="row in [...usage.daily].reverse()" :key="row.day">
            <th scope="row" class="px-3 py-1.5 font-normal">{{ formatDay(row.day, locale, 'long') }}</th>
            <td v-for="key in usage.visibleSeries" :key="key" class="px-3 py-1.5 text-right tabular-nums">{{ fmtFull(row.values[key]) }}</td>
            <td class="px-3 py-1.5 text-right font-medium tabular-nums">{{ fmtFull(row.total) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
