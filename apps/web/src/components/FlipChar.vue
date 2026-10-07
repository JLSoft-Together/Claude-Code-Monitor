<script setup lang="ts">
defineProps<{ value: string }>()
</script>

<template>
  <span class="ccm-flip relative inline-block overflow-hidden align-bottom">
    <Transition name="ccm-flip">
      <span :key="value" class="block">{{ value }}</span>
    </Transition>
  </span>
</template>
