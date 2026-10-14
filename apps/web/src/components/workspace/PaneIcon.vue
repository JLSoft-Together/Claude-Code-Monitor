<script setup lang="ts">
import { ref, watch } from 'vue'
import { FileText, GitCompare, GitGraph, Globe, Play } from 'lucide-vue-next'
import type { Pane } from '../../stores/workspace'
import PresetIcon from './PresetIcon.vue'

const props = withDefaults(defineProps<{ pane: Pane; size?: number }>(), { size: 16 })

// The app CSP only lets favicons from the preview server / localhost through; others fall back to the globe.
const LOCAL_ICON = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i
const broken = ref(false)
watch(
  () => props.pane.favicon,
  () => (broken.value = false),
)
</script>

<template>
  <PresetIcon v-if="!pane.kind || pane.kind === 'term'" :preset="pane.preset" :size="size" />
  <template v-else-if="pane.kind === 'browser'">
    <img
      v-if="pane.favicon && LOCAL_ICON.test(pane.favicon) && !broken"
      :src="pane.favicon"
      :width="size"
      :height="size"
      class="shrink-0 rounded-[3px] object-contain"
      alt=""
      @error="broken = true"
    />
    <Globe v-else :size="size" class="text-agent-browser" aria-hidden="true" />
  </template>
  <FileText v-else-if="pane.kind === 'file'" :size="size" class="text-agent-file" aria-hidden="true" />
  <GitGraph v-else-if="pane.kind === 'log'" :size="size" class="text-ink-muted" aria-hidden="true" />
  <Play v-else-if="pane.kind === 'run'" :size="size" class="text-ink-muted" aria-hidden="true" />
  <GitCompare v-else :size="size" class="text-ink-muted" aria-hidden="true" />
</template>
