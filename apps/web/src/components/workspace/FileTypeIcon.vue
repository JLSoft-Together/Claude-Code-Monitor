<script setup lang="ts">
import type { AtomIcon } from '../../lib/explorer/fileIcons'

withDefaults(defineProps<{ icon: AtomIcon; size?: number }>(), { size: 16 })
</script>

<template>
  <span
    v-if="icon.themed"
    class="shrink-0 bg-current"
    :style="{ width: `${size}px`, height: `${size}px`, maskImage: `url(${icon.src})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }"
    :data-file-icon="icon.src"
    aria-hidden="true"
  />
  <img v-else :src="icon.src" :width="size" :height="size" class="shrink-0" alt="" draggable="false" decoding="async" :data-file-icon="icon.src" />
</template>
