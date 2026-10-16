<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Asterisk, CircleAlert, Gauge, Hexagon, OctagonAlert, RotateCcw, TrendingUp } from 'lucide-vue-next'
import type { LimitWindow, PlanLimits, Provider } from '@ccm/shared'
import { now, relativeTime } from '../../lib/format'
import { useExtrasStore } from '../../stores/extras'
import CountNum from '../CountNum.vue'

const STALE_MS = 30 * 60_000

const { t, locale } = useI18n()
const extras = useExtrasStore()

const clockFormat = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }))

function countdown(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return t('limits.durShort.dh', { d, h })
  if (h > 0) return t('limits.durShort.hm', { h, m })
  return t('limits.durShort.m', { m })
}

const LEVEL = {
  ok: { bar: 'bg-accent', text: 'text-ink', icon: Gauge },
  warn: { bar: 'bg-warning', text: 'text-warning', icon: CircleAlert },
  critical: { bar: 'bg-st-error', text: 'text-st-error', icon: OctagonAlert },
} as const
const STALE = { bar: 'bg-ink-faint', text: 'text-ink-muted' }

function view(key: 'fiveHour' | 'sevenDay', w: LimitWindow | undefined, stale: boolean) {
  if (!w) return null
  const pct = Math.round(w.usedPct)
  const level: keyof typeof LEVEL = pct >= 95 ? 'critical' : pct >= 80 ? 'warn' : 'ok'
  const resets = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  const fullAt = w.forecast?.fullAt ? Date.parse(w.forecast.fullAt) : NaN
  const risk = pct < 100 && Number.isFinite(fullAt) && w.forecast?.beforeReset === true && fullAt > now.value
  const tone = stale ? STALE : LEVEL[level]
  return {
    key,
    pct,
    left: Math.max(0, 100 - pct),
    level,
    icon: LEVEL[level].icon,
    bar: tone.bar,
    text: tone.text,
    label: t(`limits.${key}Long`),
    resetsIn: Number.isFinite(resets) && resets > now.value ? countdown(resets - now.value) : null,
    fullAt: risk ? t('limits.fullAround', { at: clockFormat.value.format(fullAt), in: countdown(fullAt - now.value) }) : null,
  }
}

function group(provider: Provider, limits: PlanLimits | null) {
  if (!limits) return null
  const at = Date.parse(limits.updatedAt)
  const stale = Number.isFinite(at) && now.value - at > STALE_MS
  const windows = [view('fiveHour', limits.fiveHour, stale), view('sevenDay', limits.sevenDay, stale)].filter((w) => w !== null)
  if (!windows.length) return null
  return {
    provider,
    windows,
    stale,
    plan: limits.plan,
    updated: relativeTime(limits.updatedAt, locale.value, now.value) ?? '',
  }
}

const groups = computed(() => [group('claude', extras.limits), group('codex', extras.codexLimits)].filter((g) => g !== null))
</script>

<template>
  <section class="min-w-0" aria-labelledby="usage-limits-title">
    <h3 id="usage-limits-title" class="text-sm font-semibold text-ink">{{ t('limits.title') }}</h3>
    <TransitionGroup tag="div" name="ccm-list" class="relative mt-3 flex flex-col gap-4">
      <div v-for="g in groups" :key="g.provider" class="min-w-0">
        <p v-if="groups.length > 1" class="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          <component
            :is="g.provider === 'codex' ? Hexagon : Asterisk"
            :size="13"
            :stroke-width="2.25"
            :class="g.provider === 'codex' ? 'text-agent-codex' : 'text-agent-claude-ink'"
            aria-hidden="true"
          />{{ t(g.provider === 'codex' ? 'provider.codex' : 'provider.claude') }}
        </p>
        <div class="space-y-3">
          <div v-for="w in g.windows" :key="w.key" :title="t('limits.windowTitle', { label: w.label, pct: w.pct })">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-xs text-ink-muted">{{ w.label }}</span>
              <span class="inline-flex items-center gap-1 text-sm font-semibold tabular transition-colors duration-(--ccm-dur-base)" :class="w.text">
                <component :is="w.icon" :size="13" class="shrink-0 self-center" aria-hidden="true" />
                <span class="sr-only">{{ t(`usageV53.level.${w.level}`) }}</span>
                <CountNum :value="w.left" :duration-ms="700" />%
                <span class="text-xs font-normal text-ink-faint">{{ t('limits.leftWord') }}</span>
              </span>
            </div>
            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill" aria-hidden="true">
              <span class="ccm-grow-x block h-full">
                <span
                  class="block h-full origin-left rounded-full transition-[transform,background-color] duration-(--ccm-dur-slow) ease-out-quint"
                  :class="w.bar"
                  :style="{ transform: `scaleX(${w.left / 100})` }"
                />
              </span>
            </div>
            <p v-if="w.resetsIn || w.fullAt" class="mt-1 flex flex-wrap items-center gap-x-2 text-2xs text-ink-faint tabular">
              <span v-if="w.resetsIn" class="inline-flex items-center gap-1"><RotateCcw :size="10" aria-hidden="true" />{{ t('limits.resetsIn', { in: w.resetsIn }) }}</span>
              <span v-if="w.fullAt" class="inline-flex items-center gap-1 font-medium text-warning"><TrendingUp :size="10" aria-hidden="true" />{{ w.fullAt }}</span>
            </p>
          </div>
        </div>
        <p class="mt-2.5 text-2xs text-ink-faint">
          <template v-if="g.plan">{{ t('limits.planLabel') }}: {{ g.plan }}. </template>{{ t('limits.updated', { ago: g.updated }) }}<template v-if="g.stale">. {{ t(g.provider === 'codex' ? 'limits.codexStaleNote' : 'limits.staleNote') }}</template>
        </p>
      </div>
    </TransitionGroup>
  </section>
</template>
