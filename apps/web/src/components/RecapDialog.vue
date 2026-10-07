<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ClipboardCopy, FileDown, FileSpreadsheet, X } from 'lucide-vue-next'
import { buildRecap, download, recapCsv, type Recap } from '../lib/recap'
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

const recap = computed<Recap>(() =>
  buildRecap({
    day: day.value,
    buckets: Object.values(usage.buckets),
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

const stats = computed(() => {
  const r = recap.value
  return [
    { label: t('recap.cost'), value: money(r.cost), hint: t('recap.costHint') },
    { label: t('recap.tokens'), value: compactNumber(r.tokens.input + r.tokens.output + r.tokens.cacheWrite), hint: t('recap.tokensHint', { n: r.tokens.messages }) },
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
  const lines = [`# ${t('recap.mdTitle', { day: formatDay(r.day, locale.value, 'long') })}`, '']
  for (const s of stats.value) lines.push(`- **${s.label}:** ${s.value} (${s.hint})`)
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

const saveMd = () => download(`claude-recap-${day.value}.md`, markdown(), 'text/markdown;charset=utf-8')
const saveCsv = () => download(`claude-sessions-${day.value}.csv`, `﻿${recapCsv(recap.value)}`, 'text/csv;charset=utf-8')

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
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div v-if="ui.recapOpen" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[6vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recap-title"
          class="ccm-pop w-full max-w-[680px] rounded-xl border border-line bg-surface shadow-lg"
          @keydown="trap"
        >
          <div class="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <h2 id="recap-title" class="mr-auto text-lg font-semibold">{{ t('recap.title') }}</h2>
            <AppSelect v-model="day" :options="dayOptions" :label="t('recap.day')" size="sm" />
            <button
              type="button"
              class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
              :aria-label="t('projects.close')"
              @click="close"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </div>

          <div class="space-y-5 px-5 py-4">
            <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div v-for="s in stats" :key="s.label" class="min-w-0 rounded-lg border border-line px-3 py-2.5">
                <dt class="truncate text-xs text-ink-muted">{{ s.label }}</dt>
                <dd class="mt-0.5 truncate text-lg font-semibold tabular">{{ s.value }}</dd>
                <dd class="truncate text-2xs text-ink-faint" :title="s.hint">{{ s.hint }}</dd>
              </div>
            </dl>

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
              class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-sm transition-colors hover:border-accent hover:text-accent"
              @click="copy"
            >
              <Check v-if="copied" :size="15" class="ccm-pop text-st-done" aria-hidden="true" /><ClipboardCopy v-else :size="15" aria-hidden="true" />
              {{ copied ? t('limits.copied') : t('recap.copy') }}
            </button>
            <button
              type="button"
              class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-sm transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!recap.ended.length"
              :title="recap.ended.length ? undefined : t('recap.csvEmpty')"
              @click="saveCsv"
            >
              <FileSpreadsheet :size="15" aria-hidden="true" />{{ t('recap.csv') }}
            </button>
            <button
              type="button"
              class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
              @click="saveMd"
            >
              <FileDown :size="15" aria-hidden="true" />{{ t('recap.markdown') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
