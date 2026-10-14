<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PtyPreset } from '@ccm/shared'
import { isMac } from '../../lib/platform'
import PresetIcon from './PresetIcon.vue'

const props = defineProps<{ anchor: DOMRect; current: PtyPreset; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ pick: [preset: PtyPreset]; close: [] }>()

const { t } = useI18n()
const PRESETS: PtyPreset[] = ['claude', 'codex', 'shell']
const WIDTH = 220
const root = ref<HTMLElement | null>(null)
const items = ref<HTMLButtonElement[]>([])

const style = computed(() => {
  const left = Math.max(12, Math.min(props.anchor.right - WIDTH, window.innerWidth - WIDTH - 12))
  return { left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `${WIDTH}px` }
})

function pick(preset: PtyPreset): void {
  emit('pick', preset)
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    props.trigger?.focus()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const list = items.value
  const at = list.indexOf(document.activeElement as HTMLButtonElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[next]?.focus()
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!root.value?.contains(target) && !props.trigger?.contains(target)) emit('close')
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  items.value[PRESETS.indexOf(props.current)]?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="ccm-menu ccm-pop fixed z-50 flex flex-col p-1" :style="style" role="menu" :aria-label="t('workspace.splitMenu.title')" @keydown="onKey">
      <p class="px-2 pb-1 pt-1.5 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('workspace.splitMenu.title') }}</p>
      <button
        v-for="preset in PRESETS"
        :key="preset"
        ref="items"
        type="button"
        role="menuitem"
        class="flex h-8 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
        @click="pick(preset)"
      >
        <PresetIcon :preset="preset" :size="15" class="shrink-0 opacity-80" />
        <span class="flex-1 truncate">{{ t(`workspace.preset.${preset}`) }}</span>
        <span v-if="preset === current" class="shrink-0 text-2xs opacity-60">{{ isMac ? '⌘D' : 'Alt+Shift+D' }}</span>
      </button>
    </div>
  </Teleport>
</template>
