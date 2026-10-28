<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ClipboardCopy, FileDown, FileSpreadsheet, X } from 'lucide-vue-next'
import { retireOverlay } from '../lib/motion'
import { buildRecap, download, periodDays, periodTotals, recapCsv, type Recap } from '../lib/recap'
import { baseName, compactNumber, duration, formatCost, formatDay, now } from '../lib/format'
import { modelLabel } from '../lib/model'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useHistoryStore } from '../stores/history'
import { useUiStore } from '../stores/ui'
import { useUsageStore } from '../stores/usage'
import AppSelect from './AppSelect.vue'

const { t, locale } = useI18n()
const ui = useUiStore()
const usage = useUsageStore()
const history = useHistoryStore()
const extras = useExtrasStore()
const connection = useConnectionStore()

const day = ref(usage.today)
const dialog = ref<HTMLElement | null>(null)
const copied = ref(false)
let restoreFocus: HTMLElement | null = null

const days = computed(() => {
  const set = new Set<string>([usage.today])
  for (const b of Object.values(usage.buckets)) set.add(b.day)
  return [...set].sort().reverse().slice(0, 31)
})
const dayOptions = computed(() => days.value.map((d) => ({ value: d, label: d === usage.today ? t('recap.today') : formatDay(d, locale.value, 'long') })))
const span = ref<1 | 7>(1)
const spanOptions = computed(() => [
  { value: 1 as const, label: t('recap.spanDay') },
  { value: 7 as const, label: t('recap.spanWeek') },
])
const buckets = computed(() => Object.values(usage.buckets))
const weekly = computed(() => span.value > 1)
const periodLabel = computed(() => {
  const d = recap.value.days
  return weekly.value ? `${formatDay(d[0]!, locale.value, 'long')} – ${formatDay(d.at(-1)!, locale.value, 'long')}` : formatDay(day.value, locale.value, 'long')
})

const recap = computed<Recap>(() =>
  buildRecap({
    day: day.value,
    span: span.value,
    buckets: buckets.value,
    projectOf: usage.projectOf,
    history: history.sessions,
    timeline: history.timeline,
    response: extras.response,
    nowMs: now.value,
  }),
)

const ms = (v: number) => duration(new Date(0).toISOString(), v) ?? '0s'
const money = (v: number) => formatCost(v, locale.value)
const modelName = (id: string) => modelLabel(id, undefined, extras.modelNames) ?? id

const previous = computed(() => {
  if (!weekly.value) return null
  const prevEnd = periodDays(recap.value.days[0]!, 2)[0]!
  const p = periodTotals(buckets.value, periodDays(prevEnd, span.value))
  return p.cost > 0 || p.tokens > 0 ? p : null
})
const change = (now: number, before: number) => {
  const pct = Math.round(((now - before) / before) * 100)
  return t('recap.vsPrevious', { pct: `${pct > 0 ? '+' : ''}${pct}%` })
}

const stats = computed(() => {
  const r = recap.value
  const prev = previous.value
  return [
    { label: t('recap.cost'), value: money(r.cost), hint: prev && prev.cost > 0 ? change(r.cost, prev.cost) : t('recap.costHint') },
    {
      label: t('recap.tokens'),
      value: compactNumber(r.tokens.input + r.tokens.output + r.tokens.cacheWrite),
      hint: prev && prev.tokens > 0 ? change(r.tokens.input + r.tokens.output + r.tokens.cacheWrite, prev.tokens) : t('recap.tokensHint', { n: r.tokens.messages }),
    },
    { label: t('recap.sessions'), value: r.sessionsSeen === null ? String(r.ended.length) : String(Math.max(r.sessionsSeen, r.ended.length)), hint: t('recap.sessionsHint', { n: r.ended.length }) },
    r.time
      ? { label: t('recap.working'), value: ms(r.time.working), hint: t('recap.waitingHint', { d: ms(r.time.waiting) }) }
      : null,
    r.response && r.response.count
      ? { label: t('dashboard.response'), value: r.response.medianMs !== undefined ? ms(r.response.medianMs) : '—', hint: t('dashboard.responseSub', { n: r.response.count, long: r.response.longWaits }) }
      : null,
  ].filter((x) => x !== null)
})

function markdown(): string {
  const r = recap.value
  const lines = [`# ${t('recap.mdTitle', { day: periodLabel.value })}`, '']
  for (const s of stats.value) lines.push(`- **${s.label}:** ${s.value} (${s.hint})`)
  if (weekly.value) {
    lines.push('', `## ${t('recap.byDay')}`, '', `| ${t('recap.day')} | ${t('recap.tokens')} | ${t('recap.cost')} |`, '|---|---:|---:|')
    for (const d of r.perDay) lines.push(`| ${formatDay(d.day, locale.value, 'long')} | ${compactNumber(d.tokens)} | ${money(d.cost)} |`)
  }
  if (r.models.length) {
    lines.push('', `## ${t('recap.byModel')}`, '', `| ${t('usage.model')} | ${t('recap.tokens')} | ${t('recap.cost')} |`, '|---|---:|---:|')
    for (const m of r.models) lines.push(`| ${modelName(m.id)} | ${compactNumber(m.tokens)} | ${money(m.cost)} |`)
  }
  if (r.projects.length) {
    lines.push('', `## ${t('recap.byProject')}`, '', `| ${t('usage.project')} | ${t('recap.tokens')} | ${t('recap.cost')} |`, '|---|---:|---:|')
    for (const p of r.projects) lines.push(`| ${baseName(p.id).replace(/\|/g, '\\|')} | ${compactNumber(p.tokens)} | ${money(p.cost)} |`)
  }
  if (r.ended.length) {
    lines.push('', `## ${t('recap.endedTitle')}`, '')
    for (const s of r.ended) {
      const ran = s.startedAt ? duration(s.startedAt, Date.parse(s.endedAt)) : null
      lines.push(`- ${s.title.replace(/[*_`[\]]/g, '\\$&')}${ran ? ` — ${ran}` : ''} · ${compactNumber(s.inputTokens + s.outputTokens)} ${t('recap.tokensUnit')}`)
    }
  }
  lines.push('', `_${t('recap.note')}_`)
  return lines.join('\n')
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(markdown())
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}

const fileTag = computed(() => (weekly.value ? `week-${day.value}` : day.value))
const saveMd = () => download(`claude-recap-${fileTag.value}.md`, markdown(), 'text/markdown;charset=utf-8')
const saveCsv = () => download(`claude-sessions-${fileTag.value}.csv`, `﻿${recapCsv(recap.value)}`, 'text/csv;charset=utf-8')
const maxDayCost = computed(() => Math.max(0, ...recap.value.perDay.map((d) => d.cost)))

function close(): void {
  ui.recapOpen = false
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(
  () => ui.recapOpen,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      day.value = usage.today
      if (!history.loaded) connection.loadHistory()
      connection.loadTimeline()
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('button')?.focus()
    } else {
      restoreFocus?.focus?.()
      restoreFocus = null
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="ui.recapOpen" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto ccm-scrim px-4 py-[6vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recap-title"
          class="w-full max-w-[680px] ccm-sheet"
          @keydown="trap"
        >
          <div class="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <h2 id="recap-title" class="mr-auto text-base font-semibold">{{ weekly ? t('recap.titleWeek') : t('recap.title') }}</h2>
            <AppSelect v-model="span" :options="spanOptions" :label="t('recap.span')" size="sm" />
            <AppSelect v-model="day" :options="dayOptions" :label="weekly ? t('recap.weekEnd') : t('recap.day')" size="sm" />
            <button
              type="button"
              class="ccm-btn-plain"
              :aria-label="t('projects.close')"
              @click="close"
            >
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <div class="space-y-5 px-5 py-4">
            <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div v-for="s in stats" :key="s.label" class="min-w-0 rounded-control bg-raised px-3 py-2.5">
                <dt class="truncate text-xs text-ink-muted">{{ s.label }}</dt>
                <dd class="mt-0.5 truncate text-lg font-semibold tabular">{{ s.value }}</dd>
                <dd class="truncate text-2xs text-ink-faint" :title="s.hint">{{ s.hint }}</dd>
              </div>
            </dl>

            <section v-if="weekly">
              <h3 class="mb-1.5 text-sm font-semibold">{{ t('recap.byDay') }} <span class="text-xs font-normal text-ink-muted">· {{ periodLabel }}</span></h3>
              <ul class="space-y-1 text-sm">
                <li v-for="d in recap.perDay" :key="d.day" class="flex min-w-0 items-center gap-2">
                  <span class="w-28 shrink-0 truncate text-xs text-ink-muted">{{ formatDay(d.day, locale, 'long') }}</span>
                  <span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fill" aria-hidden="true">
                    <span class="block h-full rounded-full bg-accent" :style="{ width: maxDayCost > 0 ? `${(d.cost / maxDayCost) * 100}%` : '0%' }" />
                  </span>
                  <span class="w-14 shrink-0 text-right text-xs text-ink-faint tabular">{{ compactNumber(d.tokens) }}</span>
                  <span class="w-16 shrink-0 text-right text-xs font-medium tabular">{{ money(d.cost) }}</span>
                </li>
              </ul>
            </section>

            <div v-if="recap.models.length || recap.projects.length" class="grid gap-4 sm:grid-cols-2">
              <section v-for="g in [{ key: 'byModel', rows: recap.models, name: modelName }, { key: 'byProject', rows: recap.projects, name: baseName }]" :key="g.key" class="min-w-0">
                <h3 class="mb-1.5 text-sm font-semibold">{{ t(`recap.${g.key}`) }}</h3>
                <ul class="space-y-1 text-sm">
                  <li v-for="row in g.rows" :key="row.id" class="flex min-w-0 items-baseline gap-2">
                    <span class="min-w-0 flex-1 truncate" :title="row.id">{{ g.name(row.id) }}</span>
                    <span class="shrink-0 text-xs text-ink-faint tabular">{{ compactNumber(row.tokens) }}</span>
                    <span class="w-16 shrink-0 text-right text-xs font-medium tabular">{{ money(row.cost) }}</span>
                  </li>
                </ul>
              </section>
            </div>
            <p v-else class="text-sm text-ink-muted">{{ t('recap.noUsage') }}</p>

            <section v-if="recap.ended.length">
              <h3 class="mb-1.5 text-sm font-semibold">{{ t('recap.endedTitle') }} ({{ recap.ended.length }})</h3>
              <ul class="max-h-40 space-y-1 overflow-y-auto text-sm">
                <li v-for="s in recap.ended" :key="s.id" class="flex min-w-0 gap-2">
                  <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
                  <span class="shrink-0 text-xs text-ink-faint tabular">{{ compactNumber(s.inputTokens + s.outputTokens) }}</span>
                </li>
              </ul>
            </section>
            <p class="text-2xs text-ink-faint">{{ t('recap.note') }}</p>
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              class="ccm-btn"
              @click="copy"
            >
              <Check v-if="copied" :size="14" class="ccm-pop text-success" aria-hidden="true" /><ClipboardCopy v-else :size="14" aria-hidden="true" />
              {{ copied ? t('limits.copied') : t('recap.copy') }}
            </button>
            <button
              type="button"
              class="ccm-btn"
              :disabled="!recap.ended.length"
              :title="recap.ended.length ? undefined : t('recap.csvEmpty')"
              @click="saveCsv"
            >
              <FileSpreadsheet :size="14" aria-hidden="true" />{{ t('recap.csv') }}
            </button>
            <button
              type="button"
              class="ccm-btn ccm-btn-primary"
              @click="saveMd"
            >
              <FileDown :size="14" aria-hidden="true" />{{ t('recap.markdown') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
