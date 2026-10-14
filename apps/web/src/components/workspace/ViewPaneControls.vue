<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Columns2, X } from 'lucide-vue-next'
import { retireOverlay } from '../../lib/motion'
import type { SplitChoice } from '../../stores/workspace'
import SplitMenu from './SplitMenu.vue'

/** Split + close for browser / file / changes panes, slotted into their own toolbars. */
const emit = defineEmits<{ split: [choice: SplitChoice]; close: [] }>()

const { t } = useI18n()
const anchor = ref<DOMRect | null>(null)
const button = ref<HTMLButtonElement | null>(null)

function toggle(): void {
  anchor.value = anchor.value ? null : (button.value?.getBoundingClientRect() ?? null)
}

// Placed from a rect taken at open time: a resized window would leave it floating.
const drop = (): void => void (anchor.value = null)
window.addEventListener('resize', drop)
onBeforeUnmount(() => window.removeEventListener('resize', drop))
</script>

<template>
  <span class="flex shrink-0 items-center gap-0.5 border-l border-line pl-1">
    <button
      ref="button"
      type="button"
      class="ccm-btn-plain shrink-0 aria-expanded:bg-fill"
      :title="t('workspace.open.splitPane')"
      :aria-label="t('workspace.open.splitPane')"
      aria-haspopup="menu"
      :aria-expanded="!!anchor"
      @click="toggle"
    >
      <Columns2 :size="14" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <Transition name="ccm-menu" @before-leave="retireOverlay">
        <SplitMenu v-if="anchor" :anchor="anchor" :current="null" :trigger="button" @pick="(c) => emit('split', c)" @close="anchor = null" />
      </Transition>
    </Teleport>
    <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.open.closePane')" :aria-label="t('workspace.open.closePane')" @click="emit('close')">
      <X :size="14" aria-hidden="true" />
    </button>
  </span>
</template>
