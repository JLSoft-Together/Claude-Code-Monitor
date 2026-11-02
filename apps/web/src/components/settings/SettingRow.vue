<script setup lang="ts">
import InfoHint from './InfoHint.vue'

defineProps<{ label: string; info?: string; labelId?: string; labelFor?: string; stacked?: boolean }>()
</script>

<template>
  <div :class="stacked ? 'px-3 py-2' : 'flex items-center justify-between gap-3 px-3 py-2'">
    <div class="flex min-w-0 items-center gap-1.5" :class="stacked ? '' : 'flex-1'">
      <label v-if="labelFor" :id="labelId" :for="labelFor" class="text-sm">{{ label }}</label>
      <p v-else :id="labelId" class="text-sm">{{ label }}</p>
      <InfoHint v-if="info" :text="info" :what="label" />
    </div>
    <div v-if="stacked" class="mt-2"><slot /></div>
    <slot v-else />
  </div>
</template>
