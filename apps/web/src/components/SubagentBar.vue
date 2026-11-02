<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { tallySubagents } from '../lib/subagentBar'
import { useAgentsStore } from '../stores/agents'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ terminalId: string }>()
const { t } = useI18n()
const agents = useAgentsStore()

const tally = computed(() => tallySubagents(agents.byTerminal[props.terminalId] ?? []))
const segments = computed(() => {
  const x = tally.value
  return [
    { key: 'done', n: x.done, cls: 'bg-st-done' },
    { key: 'running', n: x.running, cls: 'bg-st-working' },
    { key: 'error', n: x.error, cls: 'bg-st-error' },
    { key: 'other', n: x.other, cls: 'bg-line-strong' },
  ].filter((s) => s.n > 0)
})
const label = computed(() => {
  const x = tally.value
  const parts = [
    x.done && t('subs.done', { n: x.done }),
    x.running && t('subs.working', { n: x.running }),
    x.error && t('subs.error', { n: x.error }),
    x.other && `${x.other}`,
  ].filter(Boolean)
  return `${t('subs.label', { n: x.total })}: ${parts.join(', ')}`
})
</script>

<template>
  <span v-if="tally.total" class="inline-flex shrink-0 items-center gap-1.5 tabular-nums" :title="label">
    <span class="flex h-1.5 w-14 gap-px overflow-hidden rounded-full bg-fill" role="img" :aria-label="label" data-sub-bar>
      <span v-for="s in segments" :key="s.key" class="h-full" :class="s.cls" :style="{ flexGrow: s.n }" />
    </span>
    <span class="text-ink-muted" aria-hidden="true">{{ tally.total }}</span>
    <span v-if="tally.error" class="inline-flex items-center gap-0.5 text-st-error" aria-hidden="true">
      <StatusIcon status="error" :size="12" :animate="false" />{{ tally.error }}
    </span>
  </span>
</template>
