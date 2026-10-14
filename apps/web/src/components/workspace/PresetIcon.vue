<script setup lang="ts">
import { computed } from 'vue'
import { Asterisk, SquareCode, SquareTerminal } from 'lucide-vue-next'
import type { PtyPreset } from '@ccm/shared'

const props = withDefaults(defineProps<{ preset: PtyPreset; size?: number }>(), { size: 16 })
const icon = computed(() => (props.preset === 'claude' ? Asterisk : props.preset === 'codex' ? SquareCode : SquareTerminal))
</script>

<template>
  <component :is="icon" :size="size" aria-hidden="true" />
</template>
