<script setup lang="ts">
defineProps<{ id: string }>()
</script>

<template>
  <div class="mt-4 first:mt-0 [&>*]:mt-0" :data-setting-row="id"><slot /></div>
</template>
