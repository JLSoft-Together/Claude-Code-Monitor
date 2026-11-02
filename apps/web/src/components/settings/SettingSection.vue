<script setup lang="ts">
defineProps<{ id: string; title?: string }>()
</script>

<template>
  <section :aria-labelledby="title ? `set-${id}` : undefined" class="mt-4 first:mt-0">
    <h3 v-if="title" :id="`set-${id}`" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ title }}</h3>
    <div class="ccm-group overflow-hidden"><slot /></div>
    <slot name="after" />
  </section>
</template>
