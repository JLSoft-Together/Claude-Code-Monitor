<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatCost } from '../lib/format'
import type { ProjectGroup } from '../lib/projectGroups'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ groups: readonly ProjectGroup[]; modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [key: string | null] }>()

const { t, locale } = useI18n()

function pick(key: string): void {
  emit('update:modelValue', props.modelValue === key ? null : key)
}

const nameOf = (g: ProjectGroup) => g.name || t('sessions.projects.noProject')
</script>

<template>
  <div v-if="groups.length > 1" role="group" :aria-label="t('sessions.projects.label')" class="mb-2.5 flex flex-wrap gap-1.5">
    <button
      v-for="g in groups"
      :key="g.key"
      type="button"
      class="inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-control border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus"
      :class="modelValue === g.key ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-fill text-ink-muted hover:text-ink'"
      :aria-pressed="modelValue === g.key"
      :title="modelValue === g.key ? t('sessions.projects.clearTitle') : `${t('sessions.projects.filterTitle', { name: nameOf(g) })}\n${g.dir}`"
      @click="pick(g.key)"
    >
      <span class="min-w-0 truncate font-medium text-ink">{{ nameOf(g) }}</span>
      <span class="shrink-0 tabular-nums">{{ t('sessions.projects.sessions', { n: g.sessions }, g.sessions) }}</span>
      <span v-if="g.waiting" class="inline-flex shrink-0 items-center gap-0.5 text-st-waiting">
        <StatusIcon status="waiting" :size="12" :animate="false" />
        <span class="tabular-nums">{{ t('sessions.projects.waiting', { n: g.waiting }) }}</span>
      </span>
      <span v-else-if="g.working" class="inline-flex shrink-0 items-center gap-0.5 text-st-working">
        <StatusIcon status="working" :size="12" :animate="false" />
        <span class="tabular-nums">{{ t('sessions.projects.working', { n: g.working }) }}</span>
      </span>
      <span v-if="g.costUsd !== undefined" class="shrink-0 tabular-nums" :title="t('sessions.projects.costTitle')">
        {{ formatCost(g.costUsd, locale) }}
      </span>
    </button>
  </div>
</template>
