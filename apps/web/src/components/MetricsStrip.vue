<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { compactNumber, duration, formatCost } from '../lib/format'
import { useExtrasStore } from '../stores/extras'
import { useAgentsStore } from '../stores/agents'
import { useSettingsStore } from '../stores/settings'
import { useTerminalsStore } from '../stores/terminals'
import { useUsageStore } from '../stores/usage'
import StatusIcon from './StatusIcon.vue'
import TokenCount from './TokenCount.vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const { t, locale } = useI18n()
const terminals = useTerminalsStore()
const agents = useAgentsStore()
const extras = useExtrasStore()
const usage = useUsageStore()
const settings = useSettingsStore()

const msLabel = (ms: number) => duration(new Date(0).toISOString(), ms) ?? '—'

const response = computed(() => {
  const r = extras.response
  const has = !!r && r.count > 0
  return {
    key: 'response',
    label: t('dashboard.response'),
    value: has && r.medianMs !== undefined ? msLabel(r.medianMs) : '—',
    status: null,
    sub: has ? t('dashboard.responseSub', { n: r.count, long: r.longWaits }) : t('dashboard.responseEmpty'),
    title: has ? t('dashboard.responseTitle', { avg: msLabel(r.totalMs / r.count) }) : undefined,
  }
})

const budget = computed(() => {
  const cost = usage.todayCost
  const limit = settings.dailyBudget
  const pct = limit > 0 ? Math.round((cost / limit) * 100) : null
  return {
    key: 'budget',
    label: t('dashboard.costToday'),
    value: usage.received ? formatCost(cost, locale.value) : '—',
    status: pct !== null && pct >= 100 ? 'error' : pct !== null && pct >= 80 ? 'waiting' : null,
    sub: pct === null ? t('dashboard.costTodaySub') : t('dashboard.budgetSub', { budget: formatCost(limit, locale.value), pct }),
    title: t('dashboard.costTodayTitle'),
    bar: pct === null ? null : { pct: Math.min(100, pct), cls: pct >= 100 ? 'bg-st-error' : pct >= 80 ? 'bg-st-waiting' : 'bg-accent' },
  }
})

const metrics = computed(() => {
  const live = terminals.live
  const liveIds = new Set(live.map((x) => x.id))
  const subs = agents.subagents
  const running = subs.filter((a) => a.status === 'working').length
  const errors = live.filter((x) => x.status === 'error').length + subs.filter((a) => a.status === 'error').length
  let tokens = 0
  for (const a of agents.list) if (liveIds.has(a.terminalId)) tokens += a.totalTokens ?? 0
  return [
    { key: 'sessions', label: t('dashboard.sessions'), value: String(live.length), status: null },
    { key: 'subagents', label: t('dashboard.subagents'), value: t('dashboard.subagentsRunning', { running, total: subs.length }), status: null },
    { key: 'working', label: t('dashboard.working'), value: String(live.filter((x) => x.status === 'working').length), status: 'working' },
    { key: 'waiting', label: t('dashboard.waiting'), value: String(live.filter((x) => x.status === 'waiting').length), status: 'waiting' },
    { key: 'errors', label: t('dashboard.errors'), value: String(errors), status: 'error' },
    { key: 'tokens', label: t('dashboard.liveTokens'), value: compactNumber(tokens), raw: tokens, status: null },
    response.value,
    budget.value,
  ]
})
</script>

<template>
  <dl v-if="compact" class="ccm-scroll flex min-w-0 items-center gap-x-4 overflow-x-auto pt-4 pb-1.5 whitespace-nowrap">
    <div v-for="m in metrics" :key="m.key" class="flex shrink-0 items-center gap-1.5" :title="'title' in m ? m.title : m.label">
      <dt class="flex items-center gap-1 text-xs text-ink-muted">
        <StatusIcon v-if="m.status" :status="m.status" :size="12" :animate="false" />
        {{ m.label }}
      </dt>
      <dd class="text-sm font-semibold text-ink tabular">
        <TokenCount v-if="'raw' in m && m.raw !== undefined" :value="m.raw" :with-unit="false" />
        <span v-else :key="m.value" class="ccm-tick">{{ m.value }}</span>
      </dd>
      <dd v-if="'bar' in m && m.bar" class="h-1 w-10 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <span class="block h-full origin-left rounded-full" :class="m.bar.cls" :style="{ transform: `scaleX(${m.bar.pct / 100})` }" />
      </dd>
    </div>
  </dl>
  <dl v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
    <div v-for="m in metrics" :key="m.key" class="min-w-0 rounded-xl border border-line bg-surface px-4 py-3" :title="'title' in m ? m.title : undefined">
      <dt class="flex items-center gap-1.5 truncate text-xs text-ink-muted">
        <StatusIcon v-if="m.status" :status="m.status" :size="13" :animate="false" />
        {{ m.label }}
      </dt>
      <dd class="mt-1 truncate text-xl font-semibold tracking-tight text-ink tabular">
        <TokenCount v-if="'raw' in m && m.raw !== undefined" :value="m.raw" :with-unit="false" />
        <span v-else :key="m.value" class="ccm-tick">{{ m.value }}</span>
      </dd>
      <dd v-if="'sub' in m" class="truncate text-2xs text-ink-faint">{{ m.sub }}</dd>
      <dd v-if="'bar' in m && m.bar" class="mt-1.5 h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <span
          class="block h-full origin-left rounded-full transition-[transform,background-color] duration-500 ease-out-quint"
          :class="m.bar.cls"
          :style="{ transform: `scaleX(${m.bar.pct / 100})` }"
        />
      </dd>
    </div>
  </dl>
</template>
