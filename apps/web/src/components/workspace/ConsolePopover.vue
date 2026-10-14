<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleX, TriangleAlert, X } from 'lucide-vue-next'
import type { ConsoleEntry } from '../../lib/agentHandoff'

const props = defineProps<{ anchor: DOMRect; entries: readonly ConsoleEntry[]; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ insert: [entries: ConsoleEntry[]]; clear: []; close: [] }>()

const { t } = useI18n()
const WIDTH = 380
const root = ref<HTMLElement | null>(null)

const style = computed(() => {
  const left = Math.max(12, Math.min(props.anchor.right - WIDTH, window.innerWidth - WIDTH - 12))
  return { left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `${WIDTH}px`, '--ccm-origin': 'top right' }
})

// Newest first in the list; the inserted block keeps page order.
const shown = computed(() => [...props.entries].reverse())

const sourceOf = (e: ConsoleEntry): string => {
  if (!e.source) return ''
  try {
    const u = new URL(e.source)
    return `${u.pathname.split('/').pop() || u.host}${e.line ? `:${e.line}` : ''}`
  } catch {
    return e.source
  }
}

function close(refocus = true): void {
  emit('close')
  if (refocus) props.trigger?.focus()
}

function insert(list: ConsoleEntry[]): void {
  emit('insert', list)
  close(false)
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!root.value?.contains(target) && !props.trigger?.contains(target)) close(false)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  }
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  root.value?.querySelector<HTMLElement>('button')?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="ccm-menu ccm-pop fixed z-50 flex max-h-[min(60vh,440px)] flex-col p-0"
      :style="style"
      role="dialog"
      :aria-label="t('workspace.handoff.consoleTitle')"
      @keydown="onKey"
    >
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1">
        <p class="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{{ t('workspace.handoff.consoleTitle') }}</p>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.handoff.close')" :aria-label="t('workspace.handoff.close')" @click="close()">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <p v-if="!entries.length" class="px-4 py-6 text-center text-xs text-ink-muted">{{ t('workspace.handoff.consoleEmpty') }}</p>
      <ul v-else class="ccm-scroll min-h-0 flex-1 overflow-y-auto p-1">
        <li v-for="e in shown" :key="`${e.at}-${e.message}`" class="group flex items-start gap-2 rounded-inner px-2 py-1.5 hover:bg-fill">
          <CircleX v-if="e.level === 'error'" :size="14" class="mt-0.5 shrink-0 text-st-error" aria-hidden="true" />
          <TriangleAlert v-else :size="14" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="sr-only">{{ t(`workspace.handoff.level.${e.level}`) }}:</span>
            <span class="line-clamp-3 break-words font-mono text-2xs text-ink">{{ e.message }}</span>
            <span v-if="e.source" class="block truncate text-2xs text-ink-faint" :title="e.source">{{ sourceOf(e) }}</span>
          </span>
          <button type="button" class="ccm-btn-plain shrink-0 text-2xs" :aria-label="`${t('workspace.handoff.insert')}: ${e.message}`" @click="insert([e])">
            {{ t('workspace.handoff.insert') }}
          </button>
        </li>
      </ul>
      <div v-if="entries.length" class="flex shrink-0 items-center justify-end gap-2 border-t border-line p-2">
        <button type="button" class="ccm-btn" @click="emit('clear')">{{ t('workspace.handoff.clear') }}</button>
        <button type="button" class="ccm-btn ccm-btn-primary" @click="insert([...entries])">{{ t('workspace.handoff.insertAll') }}</button>
      </div>
    </div>
  </Teleport>
</template>
