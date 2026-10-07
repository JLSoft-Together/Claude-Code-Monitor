<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

defineProps<{ pages: number }>()
const page = defineModel<number>({ required: true })
const { t } = useI18n()

const btn =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
</script>

<template>
  <div class="flex items-center gap-1.5 text-xs text-ink-muted">
    <button type="button" :class="btn" :disabled="page === 0" :aria-label="t('projects.prev')" @click="page--">
      <ChevronLeft :size="15" aria-hidden="true" />
    </button>
    <span :key="page" class="ccm-tick min-w-[4.5rem] text-center tabular" aria-live="polite">{{ t('projects.page', { page: page + 1, pages }) }}</span>
    <button type="button" :class="btn" :disabled="page >= pages - 1" :aria-label="t('projects.next')" @click="page++">
      <ChevronRight :size="15" aria-hidden="true" />
    </button>
  </div>
</template>
