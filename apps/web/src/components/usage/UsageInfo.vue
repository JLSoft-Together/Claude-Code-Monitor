<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from 'vue'
import { Info } from 'lucide-vue-next'
import { retireOverlay } from '../../lib/motion'

const props = withDefaults(defineProps<{ label: string; text: string; align?: 'start' | 'end' }>(), { align: 'start' })

const id = useId()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function onOutside(e: PointerEvent): void {
  if (!root.value?.contains(e.target as Node)) open.value = false
}

function onEsc(e: KeyboardEvent): void {
  if (!open.value) return
  e.preventDefault()
  open.value = false
}

watch(open, (value) => {
  if (value) document.addEventListener('pointerdown', onOutside, true)
  else document.removeEventListener('pointerdown', onOutside, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <span ref="root" class="relative inline-flex" @keydown.esc="onEsc">
    <button
      type="button"
      class="ccm-btn-plain"
      :class="open ? 'bg-fill text-ink!' : ''"
      :aria-label="props.label"
      :aria-describedby="id"
      :aria-expanded="open"
      :title="props.text"
      @click="open = !open"
    >
      <Info :size="16" aria-hidden="true" />
    </button>
    <span :id="id" class="sr-only">{{ props.text }}</span>
    <Transition name="ccm-menu" @before-leave="retireOverlay">
      <span
        v-if="open"
        class="ccm-menu absolute top-full z-40 mt-1.5 block w-[min(340px,calc(100vw-2rem))] p-3! text-xs leading-relaxed font-normal tracking-normal text-ink-muted"
        :class="props.align === 'end' ? 'right-0 [--ccm-origin:top_right]' : 'left-0 [--ccm-origin:top_left]'"
        aria-hidden="true"
      >
        {{ props.text }}
      </span>
    </Transition>
  </span>
</template>
