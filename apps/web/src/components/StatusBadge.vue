<script setup lang="ts">
import { computed } from 'vue'
import { statusMeta } from '../lib/status'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ status: string }>()
const meta = computed(() => statusMeta(props.status))
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs font-medium" :class="meta.text">
    <StatusIcon :status="status" :size="13" />
    <span>{{ $t(meta.labelKey) }}</span>
  </span>
</template>
