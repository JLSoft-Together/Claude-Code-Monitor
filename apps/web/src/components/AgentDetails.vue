<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { compactNumber, fullNumber, now, relativeTime } from '../lib/format'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import StatusBadge from './StatusBadge.vue'

const { t, locale } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()

const agent = computed(() => (ui.selectedAgentId ? agents.byId[ui.selectedAgentId] : undefined))
const terminal = computed(() => (agent.value ? terminals.byId[agent.value.terminalId] : undefined))
const terminalTitle = computed(() => displayTitle(terminal.value))

const rows = computed(() => {
  const a = agent.value
  if (!a) return []
  const out: { label: string; value: string; title?: string; mono?: boolean }[] = []
  out.push({ label: t('agent.session'), value: terminalTitle.value || '—' })
  if (a.role === 'subagent') {
    out.push({ label: t('agent.type'), value: a.type ?? '—', mono: true })
    if (a.description) out.push({ label: t('agent.currentTask'), value: a.description })
  }
  out.push({ label: t('agent.currentTool'), value: a.currentTool ?? t('agent.none'), mono: true })
  if (a.model) out.push({ label: t('agent.model'), value: a.model, mono: true })
  const started = relativeTime(a.startedAt, locale.value, now.value)
  if (started) out.push({ label: t('agent.started'), value: started, title: a.startedAt })
  const done = relativeTime(a.completedAt, locale.value, now.value)
  if (done) out.push({ label: t('agent.completed'), value: done, title: a.completedAt })
  if (a.totalTokens !== undefined) {
    out.push({
      label: t('agent.tokens'),
      value: compactNumber(a.totalTokens, locale.value),
      title: t('terminal.tokensTitle', {
        input: fullNumber(a.inputTokens, locale.value),
        output: fullNumber(a.outputTokens, locale.value),
        cache: fullNumber(a.cacheReadTokens, locale.value),
      }),
      mono: true,
    })
  }
  return out
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-1"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0 translate-y-1"
  >
    <aside
      v-if="agent"
      class="absolute right-3 bottom-3 left-3 z-10 max-h-[70%] overflow-y-auto rounded-xl border border-line-strong bg-surface p-4 shadow-lg shadow-black/10 sm:left-auto sm:w-[320px]"
      :aria-label="agent.role === 'main' ? t('agent.main') : t('agent.subagent')"
    >
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-2xs font-medium text-ink-faint">
            {{ agent.role === 'main' ? t('agent.main') : t('agent.subagent') }}
          </p>
          <h3 class="truncate text-base font-semibold" :title="agent.role === 'main' ? terminalTitle : agent.type">
            {{ agent.role === 'main' ? terminalTitle : agent.type ?? agent.name }}
          </h3>
          <StatusBadge :status="agent.status" class="mt-1" />
        </div>
        <button
          type="button"
          class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-raised hover:text-ink"
          :aria-label="t('agent.close')"
          @click="ui.selectAgent(null)"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <template v-for="row in rows" :key="row.label">
          <dt class="text-ink-faint">{{ row.label }}</dt>
          <dd class="min-w-0 break-words" :class="row.mono ? 'font-mono text-2xs leading-5' : ''" :title="row.title">
            {{ row.value }}
          </dd>
        </template>
      </dl>
    </aside>
  </Transition>
</template>
