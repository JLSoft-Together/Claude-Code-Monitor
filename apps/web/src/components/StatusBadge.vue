<script setup lang="ts">
import { computed } from 'vue'
import { statusMeta } from '../lib/status'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ status: string }>()
const meta = computed(() => statusMeta(props.status))
</script>

<template>
  <span class="inline-flex h-5 shrink-0 items-center gap-1 rounded-inner px-1.5 text-2xs font-medium whitespace-nowrap" :class="[meta.text, meta.soft]">
    <StatusIcon :status="status" :size="12" />
    <span>{{ $t(meta.labelKey) }}</span>
  </span>
</template>
