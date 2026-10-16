<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PtyPreset } from '@ccm/shared'
import { isMac } from '../../lib/platform'
import { openedByKey } from '../../lib/inputModality'
import { Globe } from 'lucide-vue-next'
import type { SplitChoice } from '../../stores/workspace'
import PresetIcon from './PresetIcon.vue'

/** `title`: menu heading instead of "Open next to it" (sidebar: new tab in a project). */
const props = defineProps<{ anchor: DOMRect; current: PtyPreset | null; trigger?: HTMLElement | null; title?: string }>()
const emit = defineEmits<{ pick: [choice: SplitChoice]; close: [] }>()

const { t } = useI18n()
const PRESETS: SplitChoice[] = ['claude', 'codex', 'shell', 'browser']
const WIDTH = 220
const root = ref<HTMLElement | null>(null)
const items = ref<HTMLButtonElement[]>([])
const byKey = openedByKey()

const style = computed(() => {
  const left = Math.max(12, Math.min(props.anchor.right - WIDTH, window.innerWidth - WIDTH - 12))
  // Grows out of the trigger's bottom edge, under its centre.
  const origin = `${Math.round(props.anchor.left + props.anchor.width / 2 - left)}px 0`
  return { left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `${WIDTH}px`, '--ccm-origin': origin }
})

function pick(choice: SplitChoice): void {
  emit('pick', choice)
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  // Tab leaves the menu like Esc: the list is teleported, so focus would otherwise jump to the end of the page.
  if (e.key === 'Escape' || e.key === 'Tab') {
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
  const down = e.key === 'ArrowDown'
  const next =
    e.key === 'Home' || (at < 0 && down) ? 0 : e.key === 'End' || at < 0 ? list.length - 1 : (at + (down ? 1 : -1) + list.length) % list.length
  list[next]?.focus()
}

function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (next && !root.value?.contains(next)) emit('close')
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!root.value?.contains(target) && !props.trigger?.contains(target)) emit('close')
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  if (byKey) items.value[Math.max(0, props.current ? PRESETS.indexOf(props.current) : 0)]?.focus()
  else root.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <div
    ref="root"
    class="ccm-menu fixed z-50 flex flex-col p-1 outline-none"
    :style="style"
    role="menu"
    tabindex="-1"
    data-menu-panel
    :aria-label="title ?? t('workspace.splitMenu.title')"
    @keydown="onKey"
    @focusout="onFocusOut"
  >
    <p class="px-2 pb-1 pt-1.5 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ title ?? t('workspace.splitMenu.title') }}</p>
    <button
      v-for="preset in PRESETS"
      :key="preset"
      ref="items"
      type="button"
      role="menuitem"
      class="group flex h-8 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
      @click="pick(preset)"
    >
      <Globe v-if="preset === 'browser'" :size="15" class="shrink-0 text-agent-browser group-focus-visible:text-on-accent" aria-hidden="true" />
      <PresetIcon v-else :preset="preset" :size="15" class="shrink-0 group-focus-visible:text-on-accent" />
      <span class="flex-1 truncate">{{ preset === 'browser' ? t('workspace.open.browser') : t(`workspace.preset.${preset}`) }}</span>
      <span v-if="preset === current && !title" class="shrink-0 text-2xs text-ink-faint group-focus-visible:text-on-accent">{{ isMac ? '⌘D' : 'Alt+Shift+D' }}</span>
    </button>
  </div>
</template>
