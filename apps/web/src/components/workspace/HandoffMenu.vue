<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Camera, MousePointerClick, TriangleAlert } from 'lucide-vue-next'
import type { HandoffAction } from '../../lib/agentHandoff'

const props = defineProps<{ anchor: DOMRect; consoleCount: number; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ pick: [action: HandoffAction]; close: [] }>()

const { t } = useI18n()
const WIDTH = 264
const root = ref<HTMLElement | null>(null)

const style = computed(() => {
  const left = Math.max(12, Math.min(props.anchor.right - WIDTH, window.innerWidth - WIDTH - 12))
  return { left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `${WIDTH}px`, '--ccm-origin': 'top right' }
})

const items = (): HTMLElement[] => [...(root.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]

function close(refocus = true): void {
  emit('close')
  if (refocus) props.trigger?.focus()
}

function choose(action: HandoffAction): void {
  emit('pick', action)
  close(false)
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
  items()[0]?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

const rowClass =
  'group flex w-full cursor-pointer items-start gap-2.5 rounded-inner px-2 py-1.5 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none'
const hintClass = 'block text-2xs text-ink-faint group-focus-visible:text-on-accent'
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="ccm-menu ccm-pop fixed z-50 flex flex-col p-1" :style="style" role="menu" :aria-label="t('workspace.handoff.menu')" @keydown="onKey">
      <button type="button" role="menuitem" :class="rowClass" @click="choose('screenshot')">
        <Camera :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block">{{ t('workspace.handoff.screenshot') }}</span>
          <span :class="hintClass">{{ t('workspace.handoff.screenshotHint') }}</span>
        </span>
      </button>
      <button type="button" role="menuitem" :class="rowClass" @click="choose('console')">
        <TriangleAlert :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block">{{ t('workspace.handoff.console') }}</span>
          <span :class="hintClass">{{ t('workspace.handoff.consoleHint', { n: consoleCount }, consoleCount) }}</span>
        </span>
        <span v-if="consoleCount" class="mt-0.5 shrink-0 rounded-full bg-fill px-1.5 text-2xs tabular text-ink-muted group-focus-visible:bg-on-accent group-focus-visible:text-accent-ink">{{
          consoleCount
        }}</span>
      </button>
      <button type="button" role="menuitem" :class="rowClass" @click="choose('pick')">
        <MousePointerClick :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block">{{ t('workspace.handoff.pick') }}</span>
          <span :class="hintClass">{{ t('workspace.handoff.pickHint') }}</span>
        </span>
      </button>
    </div>
  </Teleport>
</template>
