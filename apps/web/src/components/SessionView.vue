<script setup lang="ts">
import { computed } from 'vue'
import { useTerminalsStore } from '../stores/terminals'
import ActivityFeed from './ActivityFeed.vue'
import AgentMap from './AgentMap.vue'
import SessionCard from './SessionCard.vue'

const props = defineProps<{ terminalId: string }>()
const terminals = useTerminalsStore()
const terminal = computed(() => terminals.byId[props.terminalId])
</script>

<template>
  <div
    v-if="terminal"
    class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-var(--ccm-header-h,4.5rem)-5.5rem)] lg:min-h-[560px] lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[minmax(0,auto)_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_340px] xl:grid-rows-1"
  >
    <div class="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
      <SessionCard :terminal="terminal" />
    </div>
    <AgentMap :key="terminal.id" :terminal-id="terminal.id" class="min-h-[480px] min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 xl:row-span-1" />
    <ActivityFeed :terminal-id="terminal.id" class="max-h-[440px] min-w-0 lg:col-start-1 lg:row-start-2 lg:max-h-none lg:min-h-0 xl:col-start-3 xl:row-start-1" />
  </div>
</template>
