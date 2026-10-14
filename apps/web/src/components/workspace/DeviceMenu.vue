<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Laptop, Minus, Monitor, MonitorSmartphone, Plus, RotateCcwSquare, Smartphone, Tablet } from 'lucide-vue-next'
import { DEVICES, ZOOM_MAX, ZOOM_MIN, stepZoom, type DeviceId } from '../../lib/browserDevices'

const props = defineProps<{ anchor: DOMRect; device: DeviceId; rotated: boolean; zoom: number; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ device: [id: DeviceId]; rotate: []; zoom: [value: number]; close: [] }>()

const { t } = useI18n()
const WIDTH = 236
const ICONS = { responsive: MonitorSmartphone, iphone: Smartphone, ipad: Tablet, laptop: Laptop, desktop: Monitor } as const
const root = ref<HTMLElement | null>(null)

const style = computed(() => {
  const left = Math.max(12, Math.min(props.anchor.right - WIDTH, window.innerWidth - WIDTH - 12))
  return { left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `${WIDTH}px`, '--ccm-origin': 'top right' }
})

const items = (): HTMLElement[] => [...(root.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])]

function close(refocus = true): void {
  emit('close')
  if (refocus) props.trigger?.focus()
}

function pick(id: DeviceId): void {
  emit('device', id)
  close()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    return close()
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[next]?.focus()
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!root.value?.contains(target) && !props.trigger?.contains(target)) close(false)
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  root.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

const rowClass =
  'flex h-8 w-full cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-disabled'
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="ccm-menu ccm-pop fixed z-50 flex flex-col p-1" :style="style" role="menu" :aria-label="t('workspace.browser.deviceMenu')" @keydown="onKey">
      <p class="px-2 pb-1 pt-1.5 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('workspace.browser.device') }}</p>
      <button v-for="d in DEVICES" :key="d.id" type="button" role="menuitemradio" :aria-checked="d.id === device" :class="rowClass" @click="pick(d.id)">
        <component :is="ICONS[d.id]" :size="15" class="shrink-0" aria-hidden="true" />
        <span class="flex-1 truncate">{{ t(`workspace.browser.devices.${d.id}`) }}</span>
        <span v-if="d.width" class="shrink-0 text-2xs tabular text-ink-faint">{{ rotated ? `${d.height}×${d.width}` : `${d.width}×${d.height}` }}</span>
        <Check v-if="d.id === device" :size="14" class="shrink-0" aria-hidden="true" />
      </button>
      <div class="mx-2 my-1 h-px bg-line" role="separator" />
      <button type="button" role="menuitemcheckbox" :aria-checked="rotated" :disabled="device === 'responsive'" :class="rowClass" @click="emit('rotate')">
        <RotateCcwSquare :size="15" class="shrink-0" aria-hidden="true" />
        <span class="flex-1 truncate">{{ t('workspace.browser.rotate') }}</span>
        <Check v-if="rotated && device !== 'responsive'" :size="14" class="shrink-0" aria-hidden="true" />
      </button>
      <div class="mx-2 my-1 h-px bg-line" role="separator" />
      <div class="flex h-8 items-center gap-1 px-2 text-sm text-ink">
        <span class="flex-1">{{ t('workspace.browser.zoom') }}</span>
        <button
          type="button"
          role="menuitem"
          class="ccm-btn-plain"
          :disabled="zoom <= ZOOM_MIN"
          :title="t('workspace.browser.zoomOut')"
          :aria-label="t('workspace.browser.zoomOut')"
          @click="emit('zoom', stepZoom(zoom, -1))"
        >
          <Minus :size="14" aria-hidden="true" />
        </button>
        <button
          type="button"
          role="menuitem"
          class="ccm-btn-plain w-14 tabular text-xs"
          :title="t('workspace.browser.zoomReset')"
          :aria-label="`${t('workspace.browser.zoomReset')} (${zoom}%)`"
          @click="emit('zoom', 100)"
        >
          {{ zoom }}%
        </button>
        <button
          type="button"
          role="menuitem"
          class="ccm-btn-plain"
          :disabled="zoom >= ZOOM_MAX"
          :title="t('workspace.browser.zoomIn')"
          :aria-label="t('workspace.browser.zoomIn')"
          @click="emit('zoom', stepZoom(zoom, 1))"
        >
          <Plus :size="14" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
