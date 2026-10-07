<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderX, Maximize2, Minimize2, MoveDiagonal2, X } from 'lucide-vue-next'
import { useUsageStore } from '../../stores/usage'
import ProjectTable from './ProjectTable.vue'

const open = defineModel<boolean>({ required: true })

const { t } = useI18n()
const usage = useUsageStore()
const panel = ref<HTMLElement | null>(null)
const table = ref<InstanceType<typeof ProjectTable> | null>(null)
let returnFocus: HTMLElement | null = null

type Size = { w: number; h: number }
const SIZE_KEY = 'ccm.pickerSize'
const MIN_W = 520
const MIN_H = 360
const EDGE = 12

function readSize(): Size | null {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as Partial<Size> | null
    return v && Number.isFinite(v.w) && Number.isFinite(v.h) ? { w: v.w!, h: v.h! } : null
  } catch {
    return null
  }
}

function saveSize(): void {
  try {
    if (size.value) localStorage.setItem(SIZE_KEY, JSON.stringify(size.value))
    else localStorage.removeItem(SIZE_KEY)
  } catch {
    return
  }
}

const size = ref<Size | null>(readSize())
const maximized = ref(false)

const panelStyle = computed(() => {
  if (maximized.value) return { width: `calc(100vw - ${2 * EDGE}px)`, height: `calc(100dvh - ${2 * EDGE}px)`, top: `${EDGE}px` }
  if (!size.value) return {}
  return { width: `min(${size.value.w}px, calc(100vw - ${2 * EDGE}px))`, height: `min(${size.value.h}px, 94dvh)` }
})

function clampSize(w: number, h: number, top: number): Size {
  return {
    w: Math.round(Math.min(Math.max(w, MIN_W), window.innerWidth - 2 * EDGE)),
    h: Math.round(Math.min(Math.max(h, MIN_H), window.innerHeight - top - EDGE)),
  }
}

function startResize(e: PointerEvent): void {
  if (!panel.value) return
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  maximized.value = false
  const rect = panel.value.getBoundingClientRect()
  const start = { x: e.clientX, y: e.clientY }
  // The panel stays horizontally centred, so the corner moves half as far as the width grows.
  const move = (ev: PointerEvent) => (size.value = clampSize(rect.width + 2 * (ev.clientX - start.x), rect.height + ev.clientY - start.y, rect.top))
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', up)
    saveSize()
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', up)
}

function nudgeSize(dw: number, dh: number): void {
  if (!panel.value) return
  maximized.value = false
  const rect = panel.value.getBoundingClientRect()
  size.value = clampSize(rect.width + dw, rect.height + dh, rect.top)
  saveSize()
}

function resetSize(): void {
  maximized.value = false
  size.value = null
  saveSize()
}

function close(): void {
  open.value = false
}

function pick(id: string | null): void {
  usage.project = id
  close()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const items = panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]')
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(open, async (value) => {
  if (value) {
    returnFocus = document.activeElement as HTMLElement | null
    document.documentElement.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    await nextTick()
    table.value?.focus()
  } else {
    document.documentElement.style.overflow = ''
    document.removeEventListener('keydown', onKey)
    returnFocus?.focus()
  }
})

onBeforeUnmount(() => {
  document.documentElement.style.overflow = ''
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 bg-black/45" aria-hidden="true" @click="close" />
    </Transition>
    <Transition
      enter-active-class="transition duration-250 ease-out-quint motion-reduce:transition-none"
      enter-from-class="opacity-0 translate-y-3 scale-[0.97]"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0 translate-y-2 scale-[0.98]"
    >
      <div
        v-if="open"
        ref="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-picker-title"
        class="fixed inset-x-3 top-[6dvh] z-50 mx-auto flex flex-col rounded-2xl border border-line bg-surface shadow-2xl"
        :class="size || maximized ? '' : 'max-h-[88dvh] max-w-[1280px] sm:inset-x-6'"
        :style="panelStyle"
      >
        <div class="flex items-start gap-3 border-b border-line px-5 py-4">
          <div class="min-w-0 flex-1">
            <h2 id="project-picker-title" class="text-lg font-semibold">{{ t('projects.pickTitle') }}</h2>
            <p class="mt-0.5 text-xs text-ink-muted">{{ t('projects.pickHint') }}</p>
          </div>
          <button
            v-if="usage.project"
            type="button"
            class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-muted hover:bg-raised hover:text-ink"
            @click="pick(null)"
          >
            <FolderX :size="15" aria-hidden="true" />{{ t('usage.allProjects') }}
          </button>
          <button
            type="button"
            class="hidden size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink sm:inline-flex"
            :aria-label="maximized ? t('projects.restore') : t('projects.maximize')"
            :title="maximized ? t('projects.restore') : t('projects.maximize')"
            :aria-pressed="maximized"
            @click="maximized = !maximized"
          >
            <component :is="maximized ? Minimize2 : Maximize2" :size="16" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink"
            :aria-label="t('projects.close')"
            @click="close"
          >
            <X :size="18" aria-hidden="true" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ProjectTable ref="table" picker @pick="pick" />
        </div>
        <span
          v-if="!maximized"
          role="button"
          tabindex="0"
          :aria-label="t('projects.resizeDialog')"
          :title="t('projects.resizeDialog')"
          class="absolute right-1 bottom-1 hidden size-6 cursor-nwse-resize touch-none items-center justify-center rounded-md text-ink-faint outline-none hover:text-accent focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent sm:inline-flex"
          @pointerdown.prevent="startResize"
          @dblclick="resetSize"
          @keydown.left.prevent="nudgeSize(-32, 0)"
          @keydown.right.prevent="nudgeSize(32, 0)"
          @keydown.up.prevent="nudgeSize(0, -32)"
          @keydown.down.prevent="nudgeSize(0, 32)"
        >
          <MoveDiagonal2 :size="14" class="rotate-90" aria-hidden="true" />
        </span>
      </div>
    </Transition>
  </Teleport>
</template>
