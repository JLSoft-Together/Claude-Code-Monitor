<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Code, Cpu, FolderOpen, GitBranch, LoaderCircle, PanelLeft } from 'lucide-vue-next'
import type { OpenApp, TerminalSession } from '@ccm/shared'
import { formatUsd } from '../lib/attention'
import { duration, fullNumber, now } from '../lib/format'
import { effortLabel, modelLabel } from '../lib/model'
import { openAppKey } from '../lib/platform'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useUiStore } from '../stores/ui'
import ContextGauge from './ContextGauge.vue'
import KeyHint from './KeyHint.vue'
import StatusBadge from './StatusBadge.vue'
import SubagentCounts from './SubagentCounts.vue'

const props = defineProps<{ terminal: TerminalSession }>()
const { t, locale } = useI18n()
const agents = useAgentsStore()
const extras = useExtrasStore()
const connection = useConnectionStore()
const ui = useUiStore()

const title = computed(() => displayTitle(props.terminal) || props.terminal.id)
const ended = computed(() => props.terminal.status === 'stale')
const main = computed(() => agents.mainOf(props.terminal.id))

const detail = computed(() => {
  const term = props.terminal
  if (term.status === 'waiting') {
    const waited = term.statusSince ? duration(term.statusSince, now.value) : null
    if (term.waitingFor && waited) return t('terminal.waitingForSince', { reason: term.waitingFor, waited })
    if (term.waitingFor) return t('terminal.waitingFor', { reason: term.waitingFor })
    if (waited) return t('terminal.waitingSince', { waited })
  }
  if (main.value?.currentTool) return t('terminal.running', { tool: main.value.currentTool })
  return null
})
const elapsed = computed(() => (ended.value ? null : duration(props.terminal.startedAt, now.value)))
const model = computed(() => {
  const m = main.value
  if (!m?.model) return null
  return { label: modelLabel(m.model, m.contextWindow, extras.modelNames), effort: effortLabel(m.effort, t), id: m.model }
})
const context = computed(() => {
  const m = main.value
  if (ended.value || m?.contextTokens === undefined || !m.contextWindow) return null
  return { tokens: m.contextTokens, window: m.contextWindow, pct: m.contextPct }
})
const branch = computed(() => {
  const b = props.terminal.gitBranch
  if (!b) return null
  return b === 'HEAD' ? t('terminal.detached') : b
})
const diff = computed(() => {
  const d = props.terminal.diff
  return d && (d.files || d.untracked) ? d : null
})
const cost = computed(() => (props.terminal.costUsd === undefined ? null : formatUsd(props.terminal.costUsd)))

const openApps: { app: OpenApp; icon: typeof FolderOpen }[] = [
  { app: 'explorer', icon: FolderOpen },
  { app: 'vscode', icon: Code },
]
function open(app: OpenApp): void {
  if (!connection.openFolder(props.terminal.id, app)) ui.reportOpenResult(props.terminal.id, app, 'offline')
}
</script>

<template>
  <div class="flex min-w-0 flex-1 items-center gap-x-4 gap-y-1 overflow-hidden text-xs whitespace-nowrap text-ink-muted">
    <div class="flex min-w-0 shrink items-center gap-2">
      <StatusBadge :status="terminal.status" />
      <span class="min-w-0 truncate text-sm font-semibold text-ink" :title="title">{{ title }}</span>
      <span v-if="elapsed" class="shrink-0 tabular">{{ elapsed }}</span>
    </div>
    <span v-if="detail" class="min-w-0 truncate" :title="detail">{{ detail }}</span>
    <SubagentCounts :terminal-id="terminal.id" class="shrink-0 flex-nowrap" />
    <span v-if="model" class="inline-flex shrink-0 items-center gap-1" :title="model.id">
      <Cpu :size="12" aria-hidden="true" />{{ model.label }}<span v-if="model.effort" class="text-ink-faint">· {{ model.effort }}</span>
    </span>
    <ContextGauge v-if="context" compact class="w-28 shrink-0" :tokens="context.tokens" :window="context.window" :pct="context.pct" />
    <span v-if="branch" class="inline-flex min-w-0 shrink items-center gap-1" :title="t('terminal.branch', { branch })">
      <GitBranch :size="12" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ branch }}</span>
    </span>
    <span v-if="diff" class="inline-flex shrink-0 items-center gap-1 tabular">
      <span class="font-medium text-st-done">+{{ fullNumber(diff.insertions, locale) }}</span>
      <span class="font-medium text-st-error">−{{ fullNumber(diff.deletions, locale) }}</span>
    </span>
    <span v-if="cost" class="shrink-0 tabular" :title="t('terminal.costTitle')">{{ cost }}</span>

    <div class="ms-auto flex shrink-0 items-center gap-1">
      <button
        v-for="o in openApps"
        :key="o.app"
        type="button"
        class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        :aria-label="t('open.action', { app: t(`open.app.${openAppKey(o.app)}`), title })"
        :title="t('open.title', { app: t(`open.app.${openAppKey(o.app)}`) })"
        :disabled="!terminal.cwd || !!ui.opening"
        @click="open(o.app)"
      >
        <LoaderCircle v-if="ui.opening?.terminalId === terminal.id && ui.opening.app === o.app" :size="15" class="animate-spin" aria-hidden="true" />
        <component :is="o.icon" v-else :size="15" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 text-xs font-medium text-ink transition-colors hover:border-line-strong"
        :aria-pressed="!ui.isCollapsed('sessions')"
        aria-keyshortcuts="S"
        @click="ui.togglePanel('sessions')"
      >
        <PanelLeft :size="14" aria-hidden="true" />{{ t('bar.details') }}<KeyHint keys="S" />
      </button>
    </div>
  </div>
</template>
