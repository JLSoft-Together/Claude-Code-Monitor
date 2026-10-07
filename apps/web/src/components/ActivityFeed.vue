<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ActivityEvent } from '@ccm/shared'
import { clockTime } from '../lib/format'
import { useActivityStore } from '../stores/activity'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import StatusIcon from './StatusIcon.vue'

const { t, te, locale } = useI18n()
const activity = useActivityStore()
const agents = useAgentsStore()
const terminals = useTerminalsStore()

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
}

function terminalTitle(e: ActivityEvent): string {
  return (e.terminalId && terminals.byId[e.terminalId]?.title) || e.data?.title || '—'
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
    case 'tool.started':
    case 'tool.failed':
      return t(`activity.${e.kind.replace('.', '_')}`, { agent: agentName(e), tool: d.tool ?? t('activity.unknownTool') })
    default:
      return t(`activity.${e.kind.replace('.', '_')}`, { title: d.title ?? terminalTitle(e) })
  }
}

function secondary(e: ActivityEvent): string | null {
  if (e.kind.startsWith('agent.') && e.data?.description) return e.data.description
  if (e.kind.startsWith('tool.')) return terminalTitle(e)
  return null
}
</script>

<template>
  <section aria-labelledby="activity-title" class="flex min-h-0 flex-col">
    <div class="mb-2.5 flex items-baseline justify-between px-0.5">
      <h2 id="activity-title" class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {{ t('activity.title') }}
      </h2>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface">
      <p v-if="activity.items.length === 0" class="px-4 py-6 text-sm text-ink-muted">{{ t('activity.empty') }}</p>
      <ol v-else class="divide-y divide-line" aria-live="off">
        <li
          v-for="e in activity.items"
          :key="e.id"
          class="grid grid-cols-[auto_auto_1fr] items-start gap-x-2.5 px-3 py-2 text-xs"
          :class="e.kind === 'tool.started' ? 'text-ink-muted' : 'text-ink'"
        >
          <time :datetime="e.at" class="pt-px font-mono text-2xs text-ink-faint tabular">{{ clockTime(e.at, locale) }}</time>
          <StatusIcon :status="ICON_STATUS[e.kind] ?? 'unknown'" :size="12" :animate="false" class="mt-0.5" />
          <div class="min-w-0">
            <p class="truncate" :title="message(e)">{{ message(e) }}</p>
            <p v-if="secondary(e)" class="truncate text-2xs text-ink-faint" :title="secondary(e) ?? undefined">
              {{ secondary(e) }}
            </p>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>
