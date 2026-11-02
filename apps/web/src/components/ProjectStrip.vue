<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderTree } from 'lucide-vue-next'
import type { ProjectGroup } from '../lib/projectGroups'
import AppSelect, { type SelectOption } from './AppSelect.vue'

const props = defineProps<{ groups: readonly ProjectGroup[]; modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [key: string | null] }>()

const { t } = useI18n()

const nameOf = (g: ProjectGroup) => g.name || t('sessions.projects.noProject')
const options = computed<SelectOption<string | null>[]>(() => [
  { value: null, label: t('monitorV79.projectAll'), hint: String(props.groups.reduce((n, g) => n + g.sessions, 0)) },
  ...props.groups.map((g) => ({
    value: g.key,
    label: nameOf(g),
    hint: g.waiting ? `${g.sessions} · ${t('sessions.projects.waiting', { n: g.waiting })}` : String(g.sessions),
  })),
])
const model = computed({
  get: () => props.modelValue,
  set: (key: string | null) => emit('update:modelValue', key),
})
</script>

<template>
  <AppSelect v-if="groups.length > 1" v-model="model" :options="options" :label="t('sessions.projects.label')" :icon="FolderTree" size="sm" data-project-filter />
</template>
