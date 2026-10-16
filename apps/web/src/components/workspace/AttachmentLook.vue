<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { previewUrl } from '../../lib/preview'
import { reducedMotion } from '../../lib/motion'
import type { Attachment } from '../../stores/attachments'
import { dur, ease } from './mission/missionMotion'

const props = defineProps<{ items: readonly Attachment[]; index: number; origin: DOMRect | null; label: (a: Attachment) => string }>()
const emit = defineEmits<{ close: []; move: [index: number] }>()

const { t } = useI18n()
const card = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const src = ref<string | null>(null)
const size = ref<{ w: number; h: number } | null>(null)
const item = computed(() => props.items[props.index] ?? null)
let ticket = 0
let leaving = false

async function load(a: Attachment | null): Promise<void> {
  const mine = ++ticket
  size.value = null
  if (!a) return void (src.value = null)
  const direct = a.view ?? a.data
  if (direct) return void (src.value = direct)
  src.value = a.thumb ?? null
  const url = a.path ? (await previewUrl(a.path).catch(() => null))?.url : null
  if (mine === ticket && url) src.value = url
}

watch(item, (a) => void load(a), { immediate: true })

function onLoad(e: Event): void {
  const img = e.target as HTMLImageElement
  size.value = img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null
}

function fromOrigin(): Keyframe | null {
  const el = card.value
  const o = props.origin
  if (!el || !o || reducedMotion()) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  const s = Math.max(0.05, Math.min(o.width / r.width, o.height / r.height))
  const dx = o.left + o.width / 2 - (r.left + r.width / 2)
  const dy = o.top + o.height / 2 - (r.top + r.height / 2)
  return { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 }
}

async function enter(): Promise<void> {
  await nextTick()
  closeButton.value?.focus({ preventScroll: true })
  const start = fromOrigin() ?? { transform: 'scale(0.96)', opacity: 0 }
  card.value?.animate([start, { transform: 'none', opacity: 1 }], { duration: dur('base'), easing: ease('out-quint') })
}

async function close(): Promise<void> {
  if (leaving) return
  leaving = true
  const end = fromOrigin() ?? { transform: 'scale(0.96)', opacity: 0 }
  const run = card.value?.animate([{ transform: 'none', opacity: 1 }, end], { duration: dur('fast'), easing: ease('exit'), fill: 'forwards' })
  await run?.finished.catch(() => {})
  emit('close')
}

function step(by: number): void {
  const n = props.items.length
  if (n > 1) emit('move', (props.index + by + n) % n)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' || e.key === ' ') {
    e.preventDefault()
    e.stopPropagation()
    void close()
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    step(1)
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    step(-1)
  } else if (e.key === 'Tab') {
    const list = [...(card.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
    if (!list.length) return
    const at = list.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : (at + 1) % list.length
    e.preventDefault()
    list[next]?.focus()
  }
}

onMounted(() => void enter())
onBeforeUnmount(() => {
  ticket++
})
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center p-8" data-attach-look-layer @pointerdown.self="close" @keydown="onKey">
    <div
      ref="card"
      class="ccm-sheet flex max-h-[min(80vh,880px)] max-w-[min(80vw,1080px)] min-w-72 flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      :aria-label="item ? t('attach.look.title', { name: label(item) }) : undefined"
      data-attach-look
    >
      <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
        <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink" :title="item?.path ?? (item ? label(item) : '')">{{ item ? label(item) : '' }}</span>
        <span v-if="size" class="shrink-0 text-2xs text-ink-faint tabular" data-attach-look-size>{{ t('attach.look.size', size) }}</span>
        <template v-if="items.length > 1">
          <span class="shrink-0 text-2xs text-ink-faint tabular">{{ t('attach.look.of', { n: index + 1, total: items.length }) }}</span>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('attach.look.prev')" :aria-label="t('attach.look.prev')" data-attach-look-prev @click="step(-1)">
            <ChevronLeft :size="14" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('attach.look.next')" :aria-label="t('attach.look.next')" data-attach-look-next @click="step(1)">
            <ChevronRight :size="14" aria-hidden="true" />
          </button>
        </template>
        <button ref="closeButton" type="button" class="ccm-btn-plain shrink-0" :title="t('attach.look.close')" :aria-label="t('attach.look.close')" data-attach-look-close @click="close">
          <X :size="14" aria-hidden="true" />
        </button>
      </header>
      <div class="grid min-h-40 min-w-0 flex-1 place-items-center overflow-hidden bg-fill p-3 *:[grid-area:1/1]">
        <Transition name="ccm-fade">
          <img
            v-if="src"
            :key="`${item?.id}:${src.length}`"
            :src="src"
            :alt="item ? label(item) : ''"
            class="max-h-[min(70vh,800px)] max-w-full rounded-inner object-contain shadow-control"
            draggable="false"
            data-attach-look-image
            @load="onLoad"
          />
          <p v-else class="text-xs text-ink-muted">{{ t('attach.look.none') }}</p>
        </Transition>
      </div>
    </div>
  </div>
</template>
