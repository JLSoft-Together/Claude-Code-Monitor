<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import StatusIcon from './StatusIcon.vue'

const { t } = useI18n()
const terminals = useTerminalsStore()
const agents = useAgentsStore()

const metrics = computed(() => {
  const live = terminals.live
  const subs = agents.subagents
  const running = subs.filter((a) => a.status === 'working').length
  const errors = live.filter((x) => x.status === 'error').length + subs.filter((a) => a.status === 'error').length
  return [
    { key: 'sessions', label: t('dashboard.sessions'), value: String(live.length), status: null },
    { key: 'subagents', label: t('dashboard.subagents'), value: t('dashboard.subagentsRunning', { running, total: subs.length }), status: null },
    { key: 'working', label: t('dashboard.working'), value: String(live.filter((x) => x.status === 'working').length), status: 'working' },
    { key: 'waiting', label: t('dashboard.waiting'), value: String(live.filter((x) => x.status === 'waiting').length), status: 'waiting' },
    { key: 'errors', label: t('dashboard.errors'), value: String(errors), status: 'error' },
  ]
})
</script>

<template>
  <dl class="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
    <div v-for="m in metrics" :key="m.key" class="flex items-baseline gap-1.5">
      <dt class="flex items-center gap-1 self-center text-ink-faint">
        <StatusIcon v-if="m.status" :status="m.status" :size="12" :animate="false" />
        {{ m.label }}
      </dt>
      <dd class="font-semibold text-ink tabular">{{ m.value }}</dd>
    </div>
  </dl>
</template>
