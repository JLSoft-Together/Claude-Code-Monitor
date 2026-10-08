<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, CircleAlert, Gauge, OctagonAlert, TrendingUp } from 'lucide-vue-next'
import type { LimitWindow } from '@ccm/shared'
import { now, relativeTime } from '../lib/format'
import { useExtrasStore } from '../stores/extras'

const { t, locale } = useI18n()
const extras = useExtrasStore()

// Status line reports go quiet when no session is open; older numbers are shown dimmed rather than as current.
const STALE_MS = 30 * 60_000

const clockFormat = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }))
const resetFormat = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }))

function countdown(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return t('limits.dur.dh', { d, h })
  if (h > 0) return t('limits.dur.hm', { h, m })
  return t('limits.dur.m', { m })
}

function view(key: 'fiveHour' | 'sevenDay', w: LimitWindow | undefined) {
  if (!w) return null
  const pct = Math.round(w.usedPct)
  const level: 'ok' | 'warn' | 'critical' = pct >= 95 ? 'critical' : pct >= 80 ? 'warn' : 'ok'
  const resets = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  const hasReset = Number.isFinite(resets) && resets > now.value
  const f = w.forecast
  const fullAt = f?.fullAt ? Date.parse(f.fullAt) : NaN
  // Only a fill before the reset is worth flagging; a projection past it is just "fine".
  const risk = pct < 100 && Number.isFinite(fullAt) && f?.beforeReset === true && fullAt > now.value
  return {
    key,
    pct,
    level,
    label: t(`limits.${key}Long`),
    left: hasReset ? countdown(resets - now.value) : null,
    resetAt: hasReset ? resetFormat.value.format(resets) : null,
    rate: f ? f.pctPerHour : null,
    risk,
    fullAt: risk ? clockFormat.value.format(fullAt) : null,
    fullIn: risk ? countdown(fullAt - now.value) : null,
  }
}

const windows = computed(() => {
  const l = extras.limits
  if (!l) return []
  return [view('fiveHour', l.fiveHour), view('sevenDay', l.sevenDay)].filter((w) => w !== null)
})
const stale = computed(() => {
  const at = extras.limits ? Date.parse(extras.limits.updatedAt) : NaN
  return Number.isFinite(at) && now.value - at > STALE_MS
})
const updated = computed(() => relativeTime(extras.limits?.updatedAt, locale.value, now.value) ?? '')

const LEVEL = {
  ok: { bar: 'bg-accent', text: 'text-ink', icon: Gauge },
  warn: { bar: 'bg-st-waiting', text: 'text-st-waiting', icon: CircleAlert },
  critical: { bar: 'bg-st-error', text: 'text-st-error', icon: OctagonAlert },
} as const

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)

function onOutside(e: PointerEvent): void {
  if (!root.value?.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  open.value = false
  trigger.value?.focus()
}
watch(open, (value) => {
  if (value) {
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div v-if="windows.length" ref="root" class="relative">
    <button
      ref="trigger"
      type="button"
      class="flex cursor-pointer items-stretch gap-1 rounded-xl border border-line bg-surface p-1 text-left transition-colors hover:border-ink-faint"
      :class="stale ? 'opacity-60' : ''"
      :aria-label="t('limits.title')"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <span
        v-for="(w, i) in windows"
        :key="w.key"
        class="flex w-[88px] flex-col gap-1 px-1.5 py-1 sm:w-[156px] sm:px-2"
        :class="i > 0 ? 'border-l border-line' : ''"
      >
        <span class="flex items-baseline justify-between gap-2">
          <span class="inline-flex items-center gap-1 text-2xs text-ink-muted">
            <component :is="LEVEL[w.level].icon" :size="12" :class="[LEVEL[w.level].text, w.level === 'critical' ? 'ccm-pulse' : '']" aria-hidden="true" />{{ w.label }}
          </span>
          <span :key="w.pct" class="ccm-tick text-sm font-semibold tabular" :class="LEVEL[w.level].text">{{ w.pct }}%</span>
        </span>
        <span class="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
          <span
            class="block h-full origin-left rounded-full transition-[transform,background-color] duration-500 ease-out-quint"
            :class="LEVEL[w.level].bar"
            :style="{ transform: `scaleX(${Math.min(100, w.pct) / 100})` }"
          />
        </span>
        <span v-if="w.risk" class="hidden items-center gap-1 truncate sm:inline-flex text-2xs font-medium text-st-waiting tabular">
          <TrendingUp :size="12" class="shrink-0" aria-hidden="true" />{{ t('limits.forecastShort', { at: w.fullAt }) }}
        </span>
        <span v-else class="hidden truncate text-2xs sm:block text-ink-faint tabular">{{ w.left ? t('limits.resetsIn', { in: w.left }) : ' ' }}</span>
      </span>
      <ChevronDown :size="14" class="self-center text-ink-faint transition-transform" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      role="dialog"
      :aria-label="t('limits.title')"
      class="ccm-pop fixed inset-x-4 top-20 z-40 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[340px] rounded-xl border border-line bg-surface p-4 shadow-lg"
    >
      <p class="text-sm font-semibold text-ink">{{ t('limits.title') }}</p>
      <section v-for="w in windows" :key="w.key" class="mt-4 first-of-type:mt-3">
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-sm text-ink-muted">{{ w.label }}</span>
          <span class="text-2xl font-semibold tabular" :class="LEVEL[w.level].text">{{ w.pct }}%</span>
        </div>
        <div class="relative mt-2 h-2 overflow-hidden rounded-full bg-raised" aria-hidden="true">
          <span class="block h-full rounded-full" :class="LEVEL[w.level].bar" :style="{ width: `${Math.min(100, w.pct)}%` }" />
          <span class="absolute inset-y-0 left-[80%] w-px bg-surface" />
        </div>
        <dl class="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <template v-if="w.resetAt">
            <dt class="text-ink-faint">{{ t('limits.resetLabel') }}</dt>
            <dd class="text-right text-ink tabular">{{ w.resetAt }} <span class="text-ink-faint">({{ w.left }})</span></dd>
          </template>
          <template v-if="w.rate !== null">
            <dt class="text-ink-faint">{{ t('limits.rateLabel') }}</dt>
            <dd class="text-right text-ink tabular">{{ t('limits.rate', { rate: w.rate }) }}</dd>
          </template>
          <template v-if="w.rate !== null">
            <dt class="text-ink-faint">{{ t('limits.forecastLabel') }}</dt>
            <dd v-if="w.risk" class="inline-flex items-center justify-end gap-1 font-medium text-st-waiting tabular">
              <TrendingUp :size="12" aria-hidden="true" />{{ t('limits.fullAround', { at: w.fullAt, in: w.fullIn }) }}
            </dd>
            <dd v-else class="text-right text-st-done">{{ t('limits.safe') }}</dd>
          </template>
        </dl>
      </section>
      <p class="mt-4 border-t border-line pt-3 text-2xs text-ink-faint">
        {{ t('limits.updated', { ago: updated }) }}<template v-if="stale">. {{ t('limits.staleNote') }}</template>
      </p>
    </div>
  </div>
</template>
