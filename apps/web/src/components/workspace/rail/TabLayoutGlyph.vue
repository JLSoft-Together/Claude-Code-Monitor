<script setup lang="ts">
import { computed } from 'vue'
import { boxes, dividers } from '../../../lib/splitLayout'
import { useWorkspaceStore } from '../../../stores/workspace'

const props = defineProps<{ tabKey: string; activePane?: string | null }>()

const workspace = useWorkspaceStore()
const X = 1.5
const Y = 2.5
const W = 13
const H = 11
const round = (n: number): number => Math.round(n * 100) / 100

const root = computed(() => workspace.tabs.find((t) => t.key === props.tabKey)?.root)
const lines = computed(() =>
  (root.value ? dividers(root.value) : []).map((d) => {
    if (d.dir === 'row') {
      const x = round(X + (d.box.x + d.box.w * d.ratio) * W)
      return { x1: x, x2: x, y1: round(Y + d.box.y * H), y2: round(Y + (d.box.y + d.box.h) * H) }
    }
    const y = round(Y + (d.box.y + d.box.h * d.ratio) * H)
    return { x1: round(X + d.box.x * W), x2: round(X + (d.box.x + d.box.w) * W), y1: y, y2: y }
  }),
)
const active = computed(() => {
  const b = root.value && props.activePane ? boxes(root.value).get(props.activePane) : undefined
  if (!b) return null
  return { x: round(X + b.x * W + 1.75), y: round(Y + b.y * H + 1.75), w: Math.max(1, round(b.w * W - 3.5)), h: Math.max(1, round(b.h * H - 3.5)) }
})
</script>

<template>
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true">
    <rect :x="X" :y="Y" :width="W" :height="H" rx="2.5" />
    <line v-for="(l, i) in lines" :key="i" v-bind="l" />
    <rect
      v-if="active"
      v-bind="{ x: active.x, y: active.y, width: active.w, height: active.h }"
      rx="1"
      stroke="none"
      fill="currentColor"
      class="ccm-glyph-pane"
    />
  </svg>
</template>
