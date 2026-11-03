<script setup lang="ts">
import { computed } from 'vue'
import { Asterisk, Fish, Hexagon, SquareTerminal } from 'lucide-vue-next'
import type { PtyPreset } from '@ccm/shared'

const props = withDefaults(defineProps<{ preset: PtyPreset; size?: number }>(), { size: 16 })
const ICONS = { claude: Asterisk, codex: Hexagon, deepseek: Fish, shell: SquareTerminal } as const
// DeepSeek has no agent-* token of its own yet: neutral ink, told apart from the shell glyph by shape and weight.
const TINTS = { claude: 'text-agent-claude', codex: 'text-agent-codex', deepseek: 'text-ink', shell: 'text-agent-shell' } as const
const icon = computed(() => ICONS[props.preset] ?? SquareTerminal)
const tint = computed(() => TINTS[props.preset] ?? 'text-agent-shell')
</script>

<template>
  <component :is="icon" :size="size" :class="tint" aria-hidden="true" />
</template>
