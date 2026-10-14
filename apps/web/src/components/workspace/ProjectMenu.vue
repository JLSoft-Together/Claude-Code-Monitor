<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CirclePlay, LayoutTemplate, Play, Save, Settings2, Star } from 'lucide-vue-next'
import { hasRun } from '../../lib/desktop'
import { hasLayouts, hasScripts, listLayouts, type SavedLayout } from '../../lib/projects'
import { useRunStore } from '../../stores/run'

const props = defineProps<{ anchor: DOMRect; root: string; name: string; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ scripts: []; run: []; save: []; manage: []; open: [layout: SavedLayout]; close: [] }>()

const { t } = useI18n()
const WIDTH = 248
const menu = ref<HTMLElement | null>(null)
const layouts = ref<SavedLayout[]>([])
const run = useRunStore()
const canRun = computed(() => hasRun && run.runnable(props.root))

const style = computed(() => {
  const left = Math.max(12, Math.min(props.anchor.left, window.innerWidth - WIDTH - 12))
  const origin = `${Math.round(props.anchor.left + props.anchor.width / 2 - left)}px 0`
  return { left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `${WIDTH}px`, '--ccm-origin': origin }
})

const items = (): HTMLElement[] => [...(menu.value?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]

function act(fn: () => void): void {
  fn()
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    props.trigger?.focus()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[next]?.focus()
}

function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (next && !menu.value?.contains(next)) emit('close')
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!menu.value?.contains(target) && !props.trigger?.contains(target)) emit('close')
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  items()[0]?.focus()
  if (hasRun && !run.detected(props.root)) void run.detect(props.root)
  if (hasLayouts) layouts.value = await listLayouts(props.root)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

const ITEM =
  'group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none'
const ICON = 'shrink-0 text-ink-muted group-focus-visible:text-on-accent'
</script>

<template>
  <div
    ref="menu"
    class="ccm-menu fixed z-50 flex flex-col p-1"
    :style="style"
    role="menu"
    :aria-label="t('workspace.projects.menuFor', { name })"
    data-project-menu
    @keydown="onKey"
    @focusout="onFocusOut"
  >
    <p class="truncate px-2 pt-1.5 pb-1 text-2xs font-semibold text-ink-faint" aria-hidden="true" :title="root">{{ name }}</p>
    <button v-if="hasScripts" type="button" role="menuitem" :class="ITEM" data-menu="scripts" @click="act(() => emit('scripts'))">
      <Play :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('workspace.scripts.open') }}</span>
    </button>
    <button v-if="canRun" type="button" role="menuitem" :class="ITEM" data-menu="run" @click="act(() => emit('run'))">
      <CirclePlay :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('run.open') }}</span>
    </button>
    <template v-if="hasLayouts">
      <div class="mx-2 my-1 border-t border-line" role="separator" />
      <p v-if="layouts.length" class="px-2 pt-0.5 pb-1 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('workspace.layouts.section') }}</p>
      <button v-for="l in layouts" :key="l.id" type="button" role="menuitem" :class="ITEM" data-menu="layout" :title="l.name" @click="act(() => emit('open', l))">
        <LayoutTemplate :size="14" :class="ICON" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ l.name }}</span>
        <Star v-if="l.openOnStart" :size="12" class="shrink-0 text-favorite group-focus-visible:text-on-accent" :aria-label="t('workspace.layouts.onStart')" />
      </button>
      <button type="button" role="menuitem" :class="ITEM" data-menu="save" @click="act(() => emit('save'))">
        <Save :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('workspace.layouts.save') }}</span>
      </button>
      <button v-if="layouts.length" type="button" role="menuitem" :class="ITEM" data-menu="manage" @click="act(() => emit('manage'))">
        <Settings2 :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('workspace.layouts.manage') }}</span>
      </button>
    </template>
  </div>
</template>
