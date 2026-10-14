<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Block } from '../../lib/diffBlocks'

/** Overview strip beside the file viewer's scrollbar (shown when the minimap is off): one tick per change. */
const props = defineProps<{ blocks: readonly Pick<Block, 'line1' | 'line2' | 'type'>[]; lineCount: number }>()
const emit = defineEmits<{ jump: [index: number] }>()

const { t } = useI18n()
const ticks = computed(() => {
  const n = Math.max(1, props.lineCount)
  return props.blocks.map((b, i) => ({
    i,
    type: b.type,
    top: `${(b.line1 / n) * 100}%`,
    height: `max(3px, ${((Math.max(b.line2, b.line1 + 1) - b.line1) / n) * 100}%)`,
    label: `${t(`workspace.gutter.kind.${b.type}`)} — ${t('workspace.gutter.popup', { n: i + 1, total: props.blocks.length })}`,
  }))
})
</script>

<template>
  <div class="ruler relative w-2 shrink-0 border-l border-well-line" role="group" :aria-label="t('workspace.gutter.ruler')" data-change-ruler>
    <button
      v-for="tk in ticks"
      :key="tk.i"
      type="button"
      tabindex="-1"
      class="tick absolute right-0.5 left-0.5 cursor-pointer rounded-[1px]"
      :class="`is-${tk.type}`"
      :style="{ top: tk.top, height: tk.height }"
      :title="tk.label"
      :aria-label="tk.label"
      @click="emit('jump', tk.i)"
    />
  </div>
</template>

<style scoped>
.tick.is-added {
  background: var(--ccm-diff-add-well);
}
.tick.is-modified {
  background: var(--ccm-diff-mod-well);
}
.tick.is-deleted {
  background: var(--ccm-diff-del-well);
}
</style>
