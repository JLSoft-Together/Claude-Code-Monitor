<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ProjectTable from './ProjectTable.vue'

const { t } = useI18n()
</script>

<template>
  <section class="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="usage-projects-title">
    <h3 id="usage-projects-title" class="text-base font-semibold">{{ t('usage.byProject') }}</h3>
    <p class="mt-0.5 mb-4 text-xs text-ink-muted">{{ t('usage.byProjectHint') }}</p>
    <ProjectTable />
  </section>
</template>
