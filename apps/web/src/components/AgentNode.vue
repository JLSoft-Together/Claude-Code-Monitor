<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { isQuiet, statusMeta } from '../lib/status'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ data: { agentId: string } }>()

const { t } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()
const highlighted = inject<ComputedRef<Set<string> | null>>('ccm-highlight')

const agent = computed(() => agents.byId[props.data.agentId])
const isMain = computed(() => agent.value?.role === 'main')
const meta = computed(() => statusMeta(agent.value?.status))
const terminal = computed(() => (agent.value ? terminals.byId[agent.value.terminalId] : undefined))
const selected = computed(() => ui.selectedAgentId === props.data.agentId)
const dimmed = computed(() => {
  const set = highlighted?.value
  return set ? !set.has(props.data.agentId) : false
})
const quiet = computed(() => (agent.value ? isQuiet(agent.value.status) : false))

const title = computed(() => {
  const a = agent.value
  if (!a) return ''
  return isMain.value ? terminal.value?.title ?? a.name ?? a.id : a.type ?? a.name ?? t('agent.subagent')
})

const subtitle = computed(() => {
  const a = agent.value
  if (!a) return ''
  if (a.currentTool && (a.status === 'working' || a.status === 'waiting')) return t('terminal.running', { tool: a.currentTool })
  if (isMain.value && terminal.value?.status === 'waiting' && terminal.value.waitingFor) {
    return t('terminal.waitingFor', { reason: terminal.value.waitingFor })
  }
  if (!isMain.value && a.description) return a.description
  return t(meta.value.labelKey)
})
</script>

<template>
  <div
    v-if="agent"
    class="relative rounded-lg border bg-surface transition-[opacity,border-color,box-shadow] duration-200"
    :class="[
      isMain ? 'w-[240px] px-3 py-2.5' : 'w-[220px] px-2.5 py-2',
      selected ? 'border-accent shadow-[0_0_0_3px_var(--ccm-accent-soft)]' : agent.status === 'working' || agent.status === 'waiting' || agent.status === 'error' ? meta.border : 'border-line',
      quiet && !selected ? 'opacity-60' : '',
      dimmed ? 'opacity-30' : '',
    ]"
  >
    <Handle type="target" :position="Position.Left" />
    <div class="flex items-center gap-2">
      <StatusIcon :status="agent.status" :size="isMain ? 15 : 13" />
      <span class="min-w-0 flex-1 truncate font-semibold" :class="isMain ? 'text-sm' : 'text-xs'" :title="title">
        {{ title }}
      </span>
      <span v-if="isMain" class="shrink-0 rounded bg-raised px-1.5 py-px text-2xs font-medium text-ink-muted">
        {{ t('agent.main') }}
      </span>
    </div>
    <p class="mt-1 truncate text-2xs" :class="agent.status === 'working' ? 'text-ink' : 'text-ink-muted'" :title="subtitle">
      <span class="sr-only">{{ t(meta.labelKey) }} · </span>{{ subtitle }}
    </p>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
