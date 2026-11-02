<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Coffee } from 'lucide-vue-next'
import { useAwakeStore } from '../stores/awake'

defineProps<{ row?: boolean }>()
const { t, locale } = useI18n()
const awake = useAwakeStore()
onMounted(() => awake.start())

const s = computed(() => awake.state)
const text = computed(() => {
  const v = s.value
  if (!v?.holding) return ''
  if (v.reason === 'grace') return t('awake.badgeGrace')
  return v.agents ? t('awake.badge', { n: v.agents }, v.agents) : t('awake.badgeJobs', { n: v.jobs }, v.jobs)
})
const tip = computed(() => {
  const v = s.value
  if (!v?.holding) return ''
  if (v.reason === 'grace' && v.releaseAt) return `${text.value}. ${t('awake.tip.grace', { time: new Date(v.releaseAt).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }) })}`
  return `${text.value}. ${t('awake.tip.working', { agents: v.agents, jobs: v.jobs })}`
})
</script>

<template>
  <p v-if="s?.holding && row" class="flex items-center gap-2 text-xs text-ink" :title="tip" :data-awake-row="s.reason">
    <Coffee :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
    <span class="min-w-0 flex-1 truncate">{{ text }}</span>
  </p>
  <span
    v-else-if="s?.holding"
    class="mr-1 inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-fill px-2 text-xs font-medium text-ink-muted"
    role="status"
    :title="tip"
    :aria-label="tip"
    :data-awake="s.reason"
  >
    <Coffee :size="14" aria-hidden="true" />
    <span class="hidden tabular-nums lg:inline">{{ text }}</span>
  </span>
</template>
