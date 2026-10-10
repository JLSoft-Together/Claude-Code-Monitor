<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pin, PinOff, X } from 'lucide-vue-next'
import { useUiStore, type Panel } from '../stores/ui'
import KeyHint from './KeyHint.vue'

const props = defineProps<{
  panel: Panel
  title: string
  titleId: string
  meta?: string
}>()

const { t } = useI18n()
const ui = useUiStore()
const pinned = computed(() => ui.panels[props.panel].pinned)
const key = computed(() => (props.panel === 'sessions' ? 'S' : 'A'))
</script>

<template>
  <div class="mb-2 flex shrink-0 items-center gap-1">
    <h2 :id="titleId" class="flex min-w-0 flex-1 items-baseline gap-2 px-0.5 text-sm font-semibold text-ink">
      <span class="truncate">{{ title }}</span>
      <span v-if="meta" class="truncate text-xs font-normal text-ink-faint tabular">{{ meta }}</span>
    </h2>
    <button
      type="button"
      class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
      :aria-pressed="pinned"
      :aria-label="pinned ? t('panel.unpin') : t('panel.pin')"
      :title="pinned ? t('panel.unpin') : t('panel.pin')"
      :aria-keyshortcuts="`Shift+${key}`"
      @click="ui.togglePanelPin(panel)"
    >
      <component :is="pinned ? PinOff : Pin" :size="15" aria-hidden="true" />
      <KeyHint :keys="`⇧${key}`" />
    </button>
    <button
      type="button"
      class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
      :aria-label="t('panel.close')"
      :title="t('panel.close')"
      :aria-keyshortcuts="key"
      @click="ui.togglePanel(panel)"
    >
      <X :size="15" aria-hidden="true" />
      <KeyHint :keys="key" />
    </button>
  </div>
</template>
