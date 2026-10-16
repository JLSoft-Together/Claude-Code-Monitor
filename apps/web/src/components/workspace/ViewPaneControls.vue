<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Columns2, GripVertical, Maximize2, Minimize2, X } from 'lucide-vue-next'
import { isMac } from '../../lib/platform'
import { retireOverlay } from '../../lib/motion'
import { isHeadBlank, zoomKeys } from '../../lib/paneHead'
import type { SplitChoice } from '../../stores/workspace'
import SplitMenu from './SplitMenu.vue'

/** Split + close for browser / file / changes panes, slotted into their own toolbars; `movable` adds the drag grip. */
const props = defineProps<{ movable?: boolean; zoomable: boolean; zoomed: boolean; hiddenCount: number }>()
const emit = defineEmits<{ split: [choice: SplitChoice]; close: []; zoom: [] }>()

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const anchor = ref<DOMRect | null>(null)
const button = ref<HTMLButtonElement | null>(null)

function toggle(): void {
  anchor.value = anchor.value ? null : (button.value?.getBoundingClientRect() ?? null)
}

const zoomLabel = computed(() => t(props.zoomed ? 'workspace.paneHead.unzoom' : 'workspace.paneHead.zoom', { key: zoomKeys(isMac) }))
const hiddenLabel = computed(() => t('workspace.paneHead.hidden', { n: props.hiddenCount }, props.hiddenCount))

let bar: HTMLElement | null = null
function onBarDblClick(e: MouseEvent): void {
  if (!bar || !(props.zoomable || props.zoomed) || !isHeadBlank(e.target, bar)) return
  e.preventDefault()
  emit('zoom')
}

onMounted(() => {
  bar = root.value?.closest<HTMLElement>('[data-pane-head]') ?? root.value?.parentElement ?? null
  bar?.addEventListener('dblclick', onBarDblClick)
})

// Placed from a rect taken at open time: a resized window would leave it floating.
const drop = (): void => void (anchor.value = null)
window.addEventListener('resize', drop)
onBeforeUnmount(() => {
  window.removeEventListener('resize', drop)
  bar?.removeEventListener('dblclick', onBarDblClick)
})
</script>

<template>
  <span ref="root" class="flex shrink-0 items-center gap-0.5 border-l border-line pl-1">
    <span
      v-if="movable"
      class="inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-[5px] text-ink-faint hover:bg-fill hover:text-ink @max-[300px]:w-6"
      :title="t('workspace.drag.paneHint', { key: isMac ? '⌘' : 'Ctrl' })"
      data-pane-grip
    >
      <GripVertical :size="14" aria-hidden="true" />
    </span>
    <Transition name="ccm-fade">
      <button
        v-if="zoomed && hiddenCount > 0"
        type="button"
        class="mx-0.5 inline-flex h-5 shrink-0 cursor-pointer items-center rounded-inner bg-accent-soft px-1.5 text-2xs font-medium text-accent-ink tabular-nums transition-colors duration-(--ccm-dur-fast) ease-out-quint hover:text-ink @max-[300px]:hidden"
        :title="hiddenLabel"
        :aria-label="hiddenLabel"
        data-pane-hidden
        @click="emit('zoom')"
      >
        +{{ hiddenCount }}
      </button>
    </Transition>
    <button
      v-if="zoomable || zoomed"
      type="button"
      class="ccm-btn-plain shrink-0 @max-[300px]:min-w-6 @max-[300px]:px-1"
      :aria-pressed="zoomed"
      :title="zoomLabel"
      :aria-label="zoomLabel"
      data-pane-zoom
      @click="emit('zoom')"
    >
      <span class="grid *:[grid-area:1/1]">
        <Transition name="ccm-fade">
          <Minimize2 v-if="zoomed" :size="14" aria-hidden="true" />
          <Maximize2 v-else :size="14" aria-hidden="true" />
        </Transition>
      </span>
    </button>
    <button
      ref="button"
      type="button"
      class="ccm-btn-plain shrink-0 aria-expanded:bg-fill @max-[300px]:min-w-6 @max-[300px]:px-1"
      :title="t('workspace.open.splitPane')"
      :aria-label="t('workspace.open.splitPane')"
      aria-haspopup="menu"
      data-pane-split
      :aria-expanded="!!anchor"
      @click="toggle"
    >
      <Columns2 :size="14" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <Transition name="ccm-menu" @before-leave="retireOverlay">
        <SplitMenu v-if="anchor" :anchor="anchor" :current="null" :trigger="button" @pick="(c) => emit('split', c)" @close="anchor = null" />
      </Transition>
    </Teleport>
    <button
      type="button"
      class="ccm-btn-plain shrink-0 @max-[300px]:min-w-6 @max-[300px]:px-1"
      :title="t('workspace.open.closePane')"
      :aria-label="t('workspace.open.closePane')"
      data-pane-close
      @click="emit('close')"
    >
      <X :size="14" aria-hidden="true" />
    </button>
  </span>
</template>
