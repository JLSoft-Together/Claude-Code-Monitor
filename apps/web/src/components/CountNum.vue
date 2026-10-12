<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useCountUp } from '../composables/useCountUp'

const props = withDefaults(defineProps<{ value: number; format?: (n: number) => string; durationMs?: number }>(), {
  format: (n: number) => String(Math.round(n)),
  durationMs: 450,
})
const shown = useCountUp(toRef(props, 'value'), props.durationMs)
const text = computed(() => props.format(shown.value))
</script>

<template>
  <span class="tabular">{{ text }}</span>
</template>
