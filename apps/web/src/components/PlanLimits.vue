<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Asterisk, CircleAlert, Gauge, Hexagon, OctagonAlert, RotateCcw, TrendingUp } from 'lucide-vue-next'
import type { LimitWindow, Provider } from '@ccm/shared'
import { now, relativeTime } from '../lib/format'
import { retireOverlay } from '../lib/motion'
import { useExtrasStore } from '../stores/extras'
import { useCountUp } from '../composables/useCountUp'

const props = withDefaults(defineProps<{ provider?: Provider }>(), { provider: 'claude' })
const { t, locale } = useI18n()
const extras = useExtrasStore()
const codex = computed(() => props.provider === 'codex')
const limits = computed(() => (codex.value ? extras.codexLimits : extras.limits))
const heading = computed(() => t(codex.value ? 'limits.codexTitle' : 'limits.title'))

// Reports go quiet when no session (or Codex run) is open; older numbers are shown dimmed rather than as current.
const STALE_MS = 30 * 60_000

const clockFormat = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }))
const resetFormat = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }))

function countdown(ms: number, short = false): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const unit = short ? 'limits.durShort' : 'limits.dur'
  if (d > 0) return t(`${unit}.dh`, { d, h })
  if (h > 0) return t(`${unit}.hm`, { h, m })
  return t(`${unit}.m`, { m })
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
    left: Math.max(0, 100 - pct),
    level,
    label: t(`limits.${key}Long`),
    resetsIn: hasReset ? countdown(resets - now.value) : null,
    resetsInShort: hasReset ? countdown(resets - now.value, true) : null,
    resetAt: hasReset ? resetFormat.value.format(resets) : null,
    rate: f ? f.pctPerHour : null,
    risk,
    fullAt: risk ? clockFormat.value.format(fullAt) : null,
    fullIn: risk ? countdown(fullAt - now.value) : null,
  }
}

const windows = computed(() => {
  const l = limits.value
  if (!l) return []
  return [view('fiveHour', l.fiveHour), view('sevenDay', l.sevenDay)].filter((w) => w !== null)
})
const stale = computed(() => {
  const at = limits.value ? Date.parse(limits.value.updatedAt) : NaN
  return Number.isFinite(at) && now.value - at > STALE_MS
})
const updated = computed(() => relativeTime(limits.value?.updatedAt, locale.value, now.value) ?? '')

type WindowKey = 'fiveHour' | 'sevenDay'

const fiveLeft = computed(() => Math.max(0, 100 - Math.round(limits.value?.fiveHour?.usedPct ?? 0)))
const sevenLeft = computed(() => Math.max(0, 100 - Math.round(limits.value?.sevenDay?.usedPct ?? 0)))
const shown: Record<WindowKey, ReturnType<typeof useCountUp>> = {
  fiveHour: useCountUp(fiveLeft, 700),
  sevenDay: useCountUp(sevenLeft, 700),
}

const changes = reactive<Record<WindowKey, { delta: number; n: number }>>({
  fiveHour: { delta: 0, n: 0 },
  sevenDay: { delta: 0, n: 0 },
})

function track(key: WindowKey, source: () => number | undefined): void {
  watch(source, (to, from) => {
    if (to === undefined || from === undefined || to === from) return
    changes[key].delta = to - from
    changes[key].n++
  })
}
track('fiveHour', () => (limits.value?.fiveHour ? fiveLeft.value : undefined))
track('sevenDay', () => (limits.value?.sevenDay ? sevenLeft.value : undefined))

const LEVEL = {
  ok: { bar: 'bg-accent', text: 'text-ink', icon: Gauge },
  warn: { bar: 'bg-warning', text: 'text-warning', icon: CircleAlert },
  critical: { bar: 'bg-st-error', text: 'text-st-error', icon: OctagonAlert },
} as const
// An old report steps down the ink ladder instead of fading, so its numbers stay readable.
const STALE = { bar: 'bg-ink-faint', text: 'text-ink-muted' }
const tone = (level: keyof typeof LEVEL) => (stale.value ? STALE : LEVEL[level])

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
  <div v-if="windows.length" ref="root" class="relative flex">
    <button
      ref="trigger"
      type="button"
      class="flex cursor-pointer items-stretch gap-1.5 rounded-control px-1.5 py-1 text-left transition-colors hover:bg-fill"
      :class="open ? 'bg-fill' : ''"
      :aria-label="heading"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <span class="flex flex-col items-center justify-center gap-0.5 px-0.5 text-2xs font-medium" :class="codex ? 'text-agent-codex' : 'text-agent-claude-ink'" aria-hidden="true">
        <component :is="codex ? Hexagon : Asterisk" :size="14" :stroke-width="2.25" /><span class="hidden 3xl:inline">{{ t(codex ? 'provider.codex' : 'provider.claude') }}</span>
      </span>
      <span class="grid grid-cols-[auto_44px_auto] items-center gap-x-2 gap-y-0.5 sm:grid-cols-[auto_56px_auto_auto]">
        <span v-for="w in windows" :key="w.key" class="relative col-span-full grid grid-cols-subgrid items-center rounded-md py-0.5">
          <span
            v-if="changes[w.key].n"
            :key="`flash-${changes[w.key].n}`"
            class="ccm-quota-flash pointer-events-none absolute inset-0 rounded-md"
            :class="changes[w.key].delta > 0 ? 'text-success' : LEVEL[w.level].text"
            aria-hidden="true"
          />
          <span
            v-if="changes[w.key].n"
            :key="`delta-${changes[w.key].n}`"
            class="ccm-quota-delta pointer-events-none absolute -top-2.5 right-0 inline-flex items-center gap-0.5 rounded-inner bg-surface px-1.5 text-2xs font-semibold tabular shadow-control"
            :class="changes[w.key].delta > 0 ? 'text-success' : LEVEL[w.level].text"
            aria-hidden="true"
          >
            <RotateCcw v-if="changes[w.key].delta > 0" :size="10" aria-hidden="true" />{{ changes[w.key].delta > 0 ? '+' : '−' }}{{ Math.abs(changes[w.key].delta) }}%
          </span>
          <span class="text-2xs whitespace-nowrap text-ink-muted">{{ t(`limits.${w.key}`) }}</span>
          <span class="relative h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <span
              class="block h-full origin-left rounded-full transition-[transform,background-color] duration-(--ccm-dur-slow) ease-out-quint"
              :class="tone(w.level).bar"
              :style="{ transform: `scaleX(${w.left / 100})` }"
            />
            <span v-if="changes[w.key].n" :key="`shine-${changes[w.key].n}`" class="ccm-quota-shine absolute inset-y-0 left-0 w-1/3" />
          </span>
          <span :key="changes[w.key].n" class="ccm-tick inline-flex items-center justify-end gap-0.5 text-xs font-semibold whitespace-nowrap tabular" :class="tone(w.level).text">
            <component :is="LEVEL[w.level].icon" v-if="w.level !== 'ok'" :size="11" :class="w.level === 'critical' ? 'ccm-pulse' : ''" aria-hidden="true" />
            <TrendingUp v-else-if="w.risk" :size="11" class="text-warning" aria-hidden="true" />{{ Math.round(shown[w.key].value) }}%
          </span>
          <span
            class="hidden items-center gap-1 text-2xs whitespace-nowrap text-ink-faint tabular sm:inline-flex"
            :title="w.resetsIn ? `${t('limits.resetsIn', { in: w.resetsIn })} (${w.resetAt})` : undefined"
          >
            <RotateCcw :size="10" aria-hidden="true" />{{ w.resetsInShort ?? '—' }}
          </span>
        </span>
      </span>
    </button>

    <Transition name="ccm-menu" @before-leave="retireOverlay">
    <div
      v-if="open"
      role="dialog"
      :aria-label="heading"
      class="fixed inset-x-4 top-20 z-40 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[340px] ccm-menu p-4! [--ccm-origin:top_right]"
    >
      <p class="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Hexagon v-if="codex" :size="14" :stroke-width="2.25" class="text-agent-codex" aria-hidden="true" />{{ heading }}
      </p>
      <section v-for="w in windows" :key="w.key" class="mt-4 first-of-type:mt-3">
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-sm text-ink-muted">{{ w.label }}</span>
          <span class="text-2xl font-semibold tabular transition-colors duration-500" :class="LEVEL[w.level].text">{{ Math.round(shown[w.key].value) }}%<span class="ml-1.5 text-sm font-normal text-ink-faint">{{ t('limits.leftWord') }}</span></span>
        </div>
        <div class="relative mt-2 h-2 overflow-hidden rounded-full bg-fill" aria-hidden="true">
          <span
            class="block h-full origin-left rounded-full transition-[transform,background-color] duration-(--ccm-dur-slow) ease-out-quint"
            :class="LEVEL[w.level].bar"
            :style="{ transform: `scaleX(${w.left / 100})` }"
          />
          <span v-if="changes[w.key].n" :key="`shine-${changes[w.key].n}`" class="ccm-quota-shine absolute inset-y-0 left-0 w-1/3" />
          <span class="absolute inset-y-0 left-[20%] w-px bg-surface" />
        </div>
        <dl class="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt class="text-ink-faint">{{ t('limits.usedLabel') }}</dt>
          <dd class="text-right text-ink tabular">{{ w.pct }}%</dd>
          <template v-if="w.resetAt">
            <dt class="text-ink-faint">{{ t('limits.resetLabel') }}</dt>
            <dd class="text-right text-ink tabular">{{ w.resetAt }} <span class="text-ink-faint">({{ w.resetsIn }})</span></dd>
          </template>
          <template v-if="w.rate !== null">
            <dt class="text-ink-faint">{{ t('limits.rateLabel') }}</dt>
            <dd class="text-right text-ink tabular">{{ t('limits.rate', { rate: w.rate }) }}</dd>
          </template>
          <template v-if="w.rate !== null">
            <dt class="text-ink-faint">{{ t('limits.forecastLabel') }}</dt>
            <dd v-if="w.risk" class="inline-flex items-center justify-end gap-1 font-medium text-warning tabular">
              <TrendingUp :size="12" aria-hidden="true" />{{ t('limits.fullAround', { at: w.fullAt, in: w.fullIn }) }}
            </dd>
            <dd v-else class="text-right text-success">{{ t('limits.safe') }}</dd>
          </template>
        </dl>
      </section>
      <p class="mt-4 border-t border-line pt-3 text-2xs text-ink-faint">
        <template v-if="limits?.plan">{{ t('limits.planLabel') }}: {{ limits.plan }}. </template>{{ t('limits.updated', { ago: updated }) }}<template v-if="stale">. {{ t(codex ? 'limits.codexStaleNote' : 'limits.staleNote') }}</template>
      </p>
    </div>
    </Transition>
  </div>
</template>
