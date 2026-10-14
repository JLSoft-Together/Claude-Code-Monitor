<script setup lang="ts">
import { computed } from 'vue'
import { Asterisk, Hexagon, SquareTerminal } from 'lucide-vue-next'
import type { PtyPreset } from '@ccm/shared'

const props = withDefaults(defineProps<{ preset: PtyPreset; size?: number }>(), { size: 16 })
const icon = computed(() => (props.preset === 'claude' ? Asterisk : props.preset === 'codex' ? Hexagon : SquareTerminal))
const tint = computed(() => (props.preset === 'claude' ? 'text-agent-claude' : props.preset === 'codex' ? 'text-agent-codex' : 'text-agent-shell'))
</script>

<template>
  <component :is="icon" :size="size" :class="tint" aria-hidden="true" />
</template>
