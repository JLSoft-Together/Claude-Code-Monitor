<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PANEL_LIMITS, useUiStore, type PanelSize } from '../stores/ui'

const props = defineProps<{
  size: PanelSize
  axis: 'x' | 'y'
  /** +1 when dragging right/down grows the panel, -1 when it shrinks it. */
  sign: 1 | -1
  label: string
  /** Extra cap so the Agent Map keeps a usable width. */
  max?: number
}>()
const dragging = defineModel<boolean>('dragging', { default: false })

const { t } = useI18n()
const ui = useUiStore()

const STEP = 16

function set(px: number): void {
  ui.setPanelSize(props.size, props.max === undefined ? px : Math.min(px, props.max))
}

function start(e: PointerEvent): void {
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const origin = props.axis === 'x' ? e.clientX : e.clientY
  const startSize = ui.panelSize[props.size]
  dragging.value = true
  const move = (ev: PointerEvent) => set(startSize + props.sign * ((props.axis === 'x' ? ev.clientX : ev.clientY) - origin))
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    dragging.value = false
    ui.savePanelSizes()
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

function nudge(delta: number): void {
  set(ui.panelSize[props.size] + props.sign * delta)
  ui.savePanelSizes()
}
</script>

<template>
  <div
    role="separator"
    tabindex="0"
    :aria-orientation="axis === 'x' ? 'vertical' : 'horizontal'"
    :aria-label="t('panel.resize', { panel: label })"
    :title="t('panel.resizeHint')"
    :aria-valuenow="ui.panelSize[size]"
    :aria-valuemin="PANEL_LIMITS[size][0]"
    :aria-valuemax="max ?? PANEL_LIMITS[size][1]"
    class="group absolute z-20 flex touch-none items-center justify-center outline-none"
    :class="axis === 'x' ? 'w-4 cursor-col-resize' : 'h-4 cursor-row-resize'"
    @pointerdown.prevent="start"
    @dblclick="ui.resetPanelSize(size)"
    @keydown.left.prevent="axis === 'x' && nudge(-STEP)"
    @keydown.right.prevent="axis === 'x' && nudge(STEP)"
    @keydown.up.prevent="axis === 'y' && nudge(-STEP)"
    @keydown.down.prevent="axis === 'y' && nudge(STEP)"
  >
    <span
      class="rounded-full bg-line-strong opacity-60 transition-[opacity,background-color] duration-150 group-hover:opacity-100 group-hover:bg-accent group-focus-visible:opacity-100 group-focus-visible:bg-accent"
      :class="[axis === 'x' ? 'h-12 w-1' : 'h-1 w-12', dragging ? 'bg-accent opacity-100' : '']"
    />
  </div>
</template>
