<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentStatus } from '@ccm/shared'
import { useAgentsStore } from '../stores/agents'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ terminalId: string }>()
const { t } = useI18n()
const agents = useAgentsStore()

type Group = 'working' | 'waiting' | 'idle' | 'done' | 'error' | 'cancelled'
const GROUP_OF: Record<AgentStatus, Group> = {
  working: 'working',
  waiting: 'waiting',
  idle: 'idle',
  unknown: 'idle',
  completed: 'done',
  error: 'error',
  cancelled: 'cancelled',
}
const ORDER: { group: Group; status: string; text: string }[] = [
  { group: 'working', status: 'working', text: 'text-st-working' },
  { group: 'waiting', status: 'waiting', text: 'text-st-waiting' },
  { group: 'idle', status: 'idle', text: 'text-ink-muted' },
  { group: 'done', status: 'completed', text: 'text-st-done' },
  { group: 'error', status: 'error', text: 'text-st-error' },
  { group: 'cancelled', status: 'cancelled', text: 'text-ink-faint' },
]

const subs = computed(() => (agents.byTerminal[props.terminalId] ?? []).filter((a) => a.role === 'subagent'))
const counts = computed(() => {
  const out: Record<Group, number> = { working: 0, waiting: 0, idle: 0, done: 0, error: 0, cancelled: 0 }
  for (const a of subs.value) out[GROUP_OF[a.status] ?? 'idle']++
  return ORDER.filter((o) => out[o.group] > 0).map((o) => ({ ...o, n: out[o.group] }))
})
</script>

<template>
  <span v-if="!subs.length" class="text-ink-faint">{{ t('subs.none') }}</span>
  <span v-else class="inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5" :title="t('subs.total', { n: subs.length })">
    <span class="text-ink-muted">{{ t('subs.label', { n: subs.length }) }}</span>
    <span v-for="c in counts" :key="c.group" class="inline-flex items-center gap-1 tabular" :class="c.text">
      <StatusIcon :status="c.status" :size="12" :animate="c.group === 'working'" />
      <span :key="c.n" class="ccm-tick font-medium">{{ t(`subs.${c.group}`, { n: c.n }) }}</span>
    </span>
  </span>
</template>
