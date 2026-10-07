<script setup lang="ts">
import { computed } from 'vue'
import { statusMeta } from '../lib/status'

const props = withDefaults(defineProps<{ status: string; size?: number; animate?: boolean }>(), {
  size: 14,
  animate: true,
})

const meta = computed(() => statusMeta(props.status))
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
    :class="meta.text"
  >
    <g v-if="meta.glyph === 'spinner'" :class="animate ? 'ccm-spin' : ''">
      <path d="M8 2.2v11.6M2.2 8h11.6M3.9 3.9l8.2 8.2M12.1 3.9l-8.2 8.2" stroke-width="1.9" />
    </g>
    <template v-else-if="meta.glyph === 'half'">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none" />
    </template>
    <circle v-else-if="meta.glyph === 'ring'" cx="8" cy="8" r="5.6" />
    <template v-else-if="meta.glyph === 'check'">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M5.4 8.2l1.8 1.8 3.4-3.6" />
    </template>
    <template v-else-if="meta.glyph === 'alert'">
      <path d="M8 2.3l6.2 11H1.8z" />
      <path d="M8 6.6v3M8 11.6v.01" stroke-width="1.8" />
    </template>
    <template v-else-if="meta.glyph === 'cross'">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M6 6l4 4M10 6l-4 4" />
    </template>
    <circle v-else-if="meta.glyph === 'dash'" cx="8" cy="8" r="5.6" stroke-dasharray="2.2 2.2" />
    <template v-else>
      <circle cx="8" cy="8" r="5.6" stroke-dasharray="2.2 2.2" />
      <path d="M6.6 6.6a1.5 1.5 0 1 1 2 1.4c-.4.2-.6.5-.6.9M8 10.9v.01" />
    </template>
  </svg>
</template>
