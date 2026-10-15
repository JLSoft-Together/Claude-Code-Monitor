<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ width: number; min: number; max: number; label: string }>()
const emit = defineEmits<{ resize: [px: number]; commit: []; reset: [] }>()
const dragging = defineModel<boolean>('dragging', { default: false })

const { t } = useI18n()
const STEP = 16
let stop: (() => void) | null = null

function start(e: PointerEvent): void {
  if (e.button !== 0) return
  stop?.()
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const origin = e.clientX
  const from = props.width
  dragging.value = true
  const move = (ev: PointerEvent): void => emit('resize', from + ev.clientX - origin)
  const detach = (): void => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    handle.removeEventListener('lostpointercapture', end)
    stop = null
    dragging.value = false
  }
  const end = (): void => {
    if (stop !== detach) return
    detach()
    emit('commit')
  }
  stop = detach
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('lostpointercapture', end)
}

onBeforeUnmount(() => stop?.())

function set(px: number): void {
  emit('resize', px)
  emit('commit')
}
</script>

<template>
  <div
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="t('panel.resize', { panel: label })"
    :title="t('panel.resizeHint')"
    :aria-valuenow="width"
    :aria-valuemin="min"
    :aria-valuemax="max"
    class="group absolute inset-y-0 -right-3 z-20 flex w-3 cursor-col-resize touch-none items-center justify-center outline-none"
    data-side-resizer
    @pointerdown.prevent="start"
    @dblclick="emit('reset')"
    @keydown.left.prevent="set(width - STEP)"
    @keydown.right.prevent="set(width + STEP)"
    @keydown.home.prevent="set(min)"
    @keydown.end.prevent="set(max)"
  >
    <span
      class="h-12 w-1 rounded-full bg-line-strong opacity-0 transition-[opacity,background-color] duration-(--ccm-dur-fast) group-hover:bg-accent group-hover:opacity-100 group-focus-visible:bg-accent group-focus-visible:opacity-100"
      :class="dragging ? 'bg-accent opacity-100' : ''"
    />
  </div>
</template>
