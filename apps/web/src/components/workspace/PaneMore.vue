<script setup lang="ts">
import { ref } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import type { MenuEntry, Rect } from '../../lib/menu'
import { isShownIn, overflowEntries } from '../../lib/paneHead'
import ContextMenu from '../ui/ContextMenu.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ entries: MenuEntry[]; label: string }>()
const emit = defineEmits<{ pick: [id: string, anchor: HTMLElement] }>()

const button = ref<HTMLButtonElement | null>(null)
const menu = ref<{ at: Rect; entries: MenuEntry[] } | null>(null)
const REOPEN_MS = 250
let closedAt = 0

function toggle(): void {
  if (menu.value) return close()
  if (performance.now() - closedAt < REOPEN_MS) return
  const el = button.value
  if (!el) return
  const scope = el.closest('[data-pane-head]') ?? el.parentElement ?? el
  const entries = overflowEntries(props.entries, (key) => isShownIn(scope, key))
  if (!entries.length) return
  const r = el.getBoundingClientRect()
  menu.value = { at: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, entries }
}

function close(): void {
  if (!menu.value) return
  menu.value = null
  closedAt = performance.now()
}

function pick(id: string): void {
  if (button.value) emit('pick', id, button.value)
}

defineExpose({ close, button })
</script>

<template>
  <button
    ref="button"
    v-bind="$attrs"
    type="button"
    class="ccm-btn-plain shrink-0"
    :title="label"
    :aria-label="label"
    aria-haspopup="menu"
    :aria-expanded="!!menu"
    data-pane-more
    @click="toggle"
  >
    <MoreHorizontal :size="14" aria-hidden="true" />
  </button>
  <ContextMenu v-if="menu" :at="menu.at" :entries="menu.entries" :label="label" :trigger="button" @pick="pick" @close="close" />
</template>
