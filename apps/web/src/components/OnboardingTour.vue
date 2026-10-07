<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-vue-next'
import { TOUR_STEPS, markTourDone, tourDone } from '../lib/tour'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const ui = useUiStore()

const index = ref(0)
const rect = ref<DOMRect | null>(null)
const card = ref<HTMLElement | null>(null)
const narrow = ref(false)
const step = computed(() => TOUR_STEPS[index.value]!)
const last = computed(() => index.value === TOUR_STEPS.length - 1)
let restoreFocus: HTMLElement | null = null
let frame = 0

const PAD = 6
const GAP = 12
const CARD_W = 360

function target(): HTMLElement | null {
  if (!step.value.target) return null
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.value.target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? el : null
}

function measure(): void {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    narrow.value = window.innerWidth < 640
    rect.value = target()?.getBoundingClientRect() ?? null
  })
}

async function show(): Promise<void> {
  await nextTick()
  const el = target()
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  el?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  measure()
  // Smooth scrolling moves the target after the first measurement.
  if (el && !reduce) window.setTimeout(measure, 350)
  card.value?.focus()
}

const spot = computed(() => {
  const r = rect.value
  if (!r) return null
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
})

const cardStyle = computed(() => {
  const s = spot.value
  if (narrow.value || !s) return {}
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(Math.max(16, s.left), vw - CARD_W - 16)
  const below = s.top + s.height + GAP
  // Tall targets (Agent Map, session list) leave no room above or below: overlay the card inside their top edge.
  if (below + 220 <= vh) return { top: `${below}px`, left: `${left}px` }
  if (s.top - GAP - 220 >= 0) return { bottom: `${vh - s.top + GAP}px`, left: `${left}px` }
  return { top: `${Math.max(16, s.top + 16)}px`, left: `${Math.min(Math.max(16, s.left + 16), vw - CARD_W - 16)}px` }
})

function go(delta: number): void {
  const next = index.value + delta
  if (next < 0) return
  if (next >= TOUR_STEPS.length) return finish()
  index.value = next
  void show()
}

function finish(): void {
  markTourDone()
  ui.tourOpen = false
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    finish()
  } else if (e.key === 'ArrowRight') go(1)
  else if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === 'Tab') {
    const items = card.value?.querySelectorAll<HTMLElement>('button')
    if (!items?.length) return
    const first = items[0]!
    const lastItem = items[items.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      lastItem.focus()
    } else if (!e.shiftKey && document.activeElement === lastItem) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(
  () => ui.tourOpen,
  (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      ui.setView('monitor')
      index.value = 0
      void show()
    } else {
      restoreFocus?.focus?.()
      restoreFocus = null
    }
  },
)

onMounted(() => {
  window.addEventListener('resize', measure)
  window.addEventListener('scroll', measure, true)
  if (!tourDone()) window.setTimeout(() => (ui.tourOpen = true), 800)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('scroll', measure, true)
  cancelAnimationFrame(frame)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div v-if="ui.tourOpen" class="fixed inset-0 z-[60]" @keydown="onKey">
        <div v-if="!spot" class="ccm-tour-scrim absolute inset-0" />
        <div
          v-else
          class="ccm-tour-spot absolute rounded-xl ring-2 ring-accent transition-all duration-300 ease-out motion-reduce:transition-none"
          :style="{ top: `${spot.top}px`, left: `${spot.left}px`, width: `${spot.width}px`, height: `${spot.height}px` }"
          aria-hidden="true"
        />

        <div
          ref="card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          tabindex="-1"
          class="ccm-pop absolute flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-lg outline-none"
          :class="
            narrow
              ? 'inset-x-4 bottom-4'
              : spot
                ? 'w-[360px] transition-[top,left,bottom] duration-300 ease-out motion-reduce:transition-none'
                : 'top-1/2 left-1/2 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2'
          "
          :style="cardStyle"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-xs text-ink-faint tabular">{{ t('tour.progress', { n: index + 1, total: TOUR_STEPS.length }) }}</p>
              <h2 id="tour-title" class="mt-0.5 text-base font-semibold">{{ t(`tour.steps.${step.id}.title`) }}</h2>
            </div>
            <button
              type="button"
              class="-mt-1 -mr-1 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
              :aria-label="t('tour.skip')"
              :title="t('tour.skip')"
              @click="finish"
            >
              <X :size="17" aria-hidden="true" />
            </button>
          </div>
          <p id="tour-body" class="text-sm leading-relaxed text-ink-muted">{{ t(`tour.steps.${step.id}.body`) }}</p>
          <p v-if="step.target && !spot && step.absent" class="rounded-lg bg-raised px-3 py-2 text-xs text-ink-muted">
            {{ t(`tour.steps.${step.id}.absent`) }}
          </p>

          <div class="flex items-center gap-2 pt-1">
            <div class="mr-auto flex gap-1" aria-hidden="true">
              <span
                v-for="(s, i) in TOUR_STEPS"
                :key="s.id"
                class="h-1.5 rounded-full transition-all duration-200"
                :class="i === index ? 'w-4 bg-accent' : i < index ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-line-strong'"
              />
            </div>
            <button
              v-if="index > 0"
              type="button"
              class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink"
              @click="go(-1)"
            >
              <ArrowLeft :size="15" aria-hidden="true" />{{ t('tour.back') }}
            </button>
            <button
              type="button"
              class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
              @click="go(1)"
            >
              <template v-if="last"><Check :size="15" aria-hidden="true" />{{ t('tour.done') }}</template>
              <template v-else-if="index === 0">{{ t('tour.start') }}<ArrowRight :size="15" aria-hidden="true" /></template>
              <template v-else>{{ t('tour.next') }}<ArrowRight :size="15" aria-hidden="true" /></template>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ccm-tour-scrim {
  background: color-mix(in oklab, var(--ccm-canvas) 75%, transparent);
}
.ccm-tour-spot {
  box-shadow: 0 0 0 9999px color-mix(in oklab, var(--ccm-canvas) 75%, transparent);
}
</style>
