<script setup lang="ts">
import { computed } from 'vue'

export type ArtName = 'logo' | 'empty-sessions' | 'empty-favorites' | 'empty-project-search' | 'empty-stats' | 'agent-map-bg'

const props = defineProps<{ name: ArtName }>()

const files = import.meta.glob<string>('../assets/art/*.svg', { query: '?raw', import: 'default', eager: true })

// The art was drawn in the ember palette; swap its fixed colours for theme tokens so it follows palette + dark mode.
const TOKENS: Record<string, string> = {
  '#8a8880': 'var(--ccm-ink-faint)',
  '#b4532f': 'var(--ccm-accent)',
  '#e08a68': 'var(--ccm-accent)',
  '#1b1b19': 'var(--ccm-ink)',
  '#121211': 'var(--ccm-surface)',
  '#e3b552': 'var(--ccm-waiting)',
}

const markup = computed(() => {
  const entry = Object.entries(files).find(([path]) => path.endsWith(`-${props.name}.svg`))
  if (!entry) return ''
  return entry[1].replace(/#[0-9a-f]{6}\b/gi, (hex) => TOKENS[hex.toLowerCase()] ?? hex)
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <span class="block [&>svg]:block [&>svg]:size-full" aria-hidden="true" v-html="markup" />
</template>
