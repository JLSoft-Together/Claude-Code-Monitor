<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info } from 'lucide-vue-next'

defineProps<{ text: string; what: string }>()
const { t } = useI18n()
const id = useId()
</script>

<template>
  <span class="inline-flex shrink-0">
    <button
      type="button"
      class="inline-flex size-5 cursor-help items-center justify-center rounded-full text-ink-faint transition-colors hover:text-ink-muted focus-visible:text-ink-muted"
      :title="text"
      :aria-label="t('settingsV79.info', { what })"
      :aria-describedby="id"
      data-setting-info
    >
      <Info :size="13" aria-hidden="true" />
    </button>
    <span :id="id" class="sr-only">{{ text }}</span>
  </span>
</template>
