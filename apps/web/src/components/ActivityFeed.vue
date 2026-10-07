<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActivityEvent } from '@ccm/shared'
import { clockTime, compactNumber } from '../lib/format'
import { modeMeta } from '../lib/mode'
import { displayTitle } from '../lib/title'
import { useActivityStore } from '../stores/activity'
import { useAgentsStore } from '../stores/agents'
import { ACTIVITY_PAGE_SIZES, useSettingsStore } from '../stores/settings'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import AppSelect from './AppSelect.vue'
import Pager from './Pager.vue'
import PanelHeader from './PanelHeader.vue'
import StatusIcon from './StatusIcon.vue'

const { t, te, locale } = useI18n()
const activity = useActivityStore()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()
const settings = useSettingsStore()

const ICON_STATUS: Record<string, string> = {
  'terminal.started': 'working',
  'terminal.ended': 'stale',
  'terminal.renamed': 'idle',
  'terminal.status': 'waiting',
  'session.cleared': 'idle',
  'agent.started': 'working',
  'agent.completed': 'completed',
  'agent.failed': 'error',
  'agent.cancelled': 'cancelled',
  'tool.started': 'idle',
  'tool.failed': 'error',
  'terminal.compacted': 'idle',
  'terminal.mode': 'waiting',
  'launch.started': 'working',
  'launch.failed': 'error',
  'job.blocked': 'waiting',
  'job.done': 'completed',
}

function terminalTitle(e: ActivityEvent): string {
  return (e.terminalId && displayTitle(terminals.byId[e.terminalId])) || e.data?.title || '—'
}

function agentName(e: ActivityEvent): string {
  const a = e.agentId ? agents.byId[e.agentId] : undefined
  if (a?.role === 'main') return a.name ?? terminalTitle(e)
  return a?.type ?? e.data?.agentType ?? terminalTitle(e)
}

function message(e: ActivityEvent): string {
  const d = e.data ?? {}
  if (!te(`activity.${e.kind.replace('.', '_')}`)) return e.kind
  switch (e.kind) {
    case 'terminal.renamed':
      return t('activity.terminal_renamed', { from: d.from ?? '—', to: d.to ?? '—' })
    case 'terminal.status':
      return t('activity.terminal_status', { title: terminalTitle(e), reason: d.waitingFor ?? '—' })
    case 'agent.started':
    case 'agent.completed':
    case 'agent.failed':
    case 'agent.cancelled':
      return t(`activity.${e.kind.replace('.', '_')}`, { name: d.agentType ?? agentName(e) })
    case 'terminal.compacted':
      return t('activity.terminal_compacted', {
        title: terminalTitle(e),
        pre: d.preTokens === undefined ? '—' : compactNumber(d.preTokens),
        post: d.postTokens === undefined ? '—' : compactNumber(d.postTokens),
        trigger: d.trigger && te(`activity.trigger.${d.trigger}`) ? t(`activity.trigger.${d.trigger}`) : (d.trigger ?? '—'),
      })
    case 'terminal.mode': {
      const key = modeMeta(d.mode)?.labelKey
      return t('activity.terminal_mode', { title: terminalTitle(e), mode: key ? t(key) : d.mode === 'default' ? t('mode.default') : (d.mode ?? '—') })
    }
    case 'launch.started':
    case 'launch.failed':
      return t(`activity.${e.kind.replace('.', '_')}`, {
        title: d.title ?? '—',
        mode: t(d.mode === 'continue' ? 'favorites.continue' : 'favorites.openNew'),
        error: t(d.error === 'notFound' ? 'favorites.errorNotFound' : 'favorites.errorFailed'),
      })
    case 'tool.started':
    case 'tool.failed':
      return t(`activity.${e.kind.replace('.', '_')}`, { agent: agentName(e), tool: d.tool ?? t('activity.unknownTool') })
    default:
      return t(`activity.${e.kind.replace('.', '_')}`, { title: d.title ?? terminalTitle(e) })
  }
}

const fresh = new Set<string>()
let primed = false
watch(
  () => activity.items,
  (items, prev) => {
    fresh.clear()
    if (!primed) {
      primed = true
      return
    }
    if (!prev?.length) return
    const known = new Set(prev.map((x) => x.id))
    for (const e of items) if (!known.has(e.id)) fresh.add(e.id)
  },
  { immediate: true },
)

function secondary(e: ActivityEvent): string | null {
  if (e.kind.startsWith('agent.') && e.data?.description) return e.data.description
  if (e.kind.startsWith('tool.')) return terminalTitle(e)
  return null
}

const filtered = computed(() => activity.items.filter((e) => !settings.hideTools || !e.kind.startsWith('tool.')))
const page = ref(0)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / settings.activityPageSize)))
watch([() => settings.hideTools, () => settings.activityPageSize], () => (page.value = 0))
watch(pages, (n) => {
  if (page.value > n - 1) page.value = n - 1
})
const pageSizeOptions = computed(() => ACTIVITY_PAGE_SIZES.map((n) => ({ value: n, label: t('activity.perPageOption', { n }) })))
const rangeLabel = computed(() => {
  const total = filtered.value.length
  const from = page.value * settings.activityPageSize + 1
  return t('projects.range', { from, to: Math.min(total, from + settings.activityPageSize - 1), total })
})

const body = ref<HTMLElement | null>(null)
watch(page, () => body.value?.scrollTo({ top: 0 }))

// Text is computed once per row per update instead of once per binding; only the visible page is formatted.
const rows = computed(() =>
  filtered.value
    .slice(page.value * settings.activityPageSize, (page.value + 1) * settings.activityPageSize)
    .map((e) => ({ e, text: message(e), sub: secondary(e) })),
)
</script>

<template>
  <section aria-labelledby="activity-title" class="flex min-h-0 flex-col">
    <PanelHeader panel="activity" rail="xl" title-id="activity-title" body-id="activity-body" :title="t('activity.title')" />
    <div
      v-show="!ui.isCollapsed('activity')"
      id="activity-body"
      ref="body"
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-xl border border-line bg-surface"
    >
      <div class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-surface px-3.5 py-1.5 text-xs text-ink-muted">
        <AppSelect v-model="settings.activityPageSize" :options="pageSizeOptions" :label="t('projects.perPage')" size="sm" />
        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="settings.hideTools" type="checkbox" class="size-4 cursor-pointer accent-[var(--ccm-accent)]" />
          {{ t('activity.hideTools') }}
        </label>
      </div>
      <p v-if="rows.length === 0" class="px-4 py-6 text-sm text-ink-muted">{{ t('activity.empty') }}</p>
      <TransitionGroup v-else tag="ol" name="ccm-list" class="relative divide-y divide-line" aria-live="off">
        <li
          v-for="{ e, text, sub } in rows"
          :key="e.id"
          class="grid grid-cols-[auto_auto_1fr] items-start gap-x-3 px-3.5 py-2.5 text-sm"
          :class="[e.kind === 'tool.started' ? 'text-ink-muted' : 'text-ink', fresh.has(e.id) ? 'ccm-highlight' : '']"
        >
          <time :datetime="e.at" class="pt-0.5 font-mono text-2xs text-ink-faint tabular">{{ clockTime(e.at, locale) }}</time>
          <StatusIcon :status="ICON_STATUS[e.kind] ?? 'unknown'" :size="14" :animate="false" class="mt-1" />
          <div class="min-w-0">
            <p class="truncate" :title="text">{{ text }}</p>
            <p v-if="sub" class="truncate text-xs text-ink-faint" :title="sub">{{ sub }}</p>
          </div>
        </li>
      </TransitionGroup>
      <div
        v-if="pages > 1"
        class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-3.5 py-1.5 text-xs text-ink-muted"
      >
        <span class="tabular">{{ rangeLabel }}</span>
        <Pager v-model="page" :pages="pages" />
      </div>
    </div>
  </section>
</template>
