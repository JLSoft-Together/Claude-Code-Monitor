<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { reducedMotion } from '../lib/motion'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-vue-next'
import { hasTerminals } from '../lib/desktop'
import { isMac } from '../lib/platform'
import { keyCombo, shortcutText } from '../lib/shortcuts'
import { TOURS, markTourDone, tourDone, tourFor, type TourId } from '../lib/tour'
import { useUiStore } from '../stores/ui'
import ArtImage from './ArtImage.vue'

const { t } = useI18n()
const ui = useUiStore()

const index = ref(0)
const rect = ref<DOMRect | null>(null)
const card = ref<HTMLElement | null>(null)
const narrow = ref(false)
// Kept after closing so the leave transition does not swap the card's content.
const active = ref<TourId>('monitor')
const steps = computed(() => TOURS[active.value].steps)
const step = computed(() => steps.value[index.value]!)
const last = computed(() => index.value === steps.value.length - 1)
const text = (part: 'title' | 'body' | 'absent') => t(`${TOURS[active.value].i18n}.${step.value.id}.${part}`, params.value)
// Shortcuts quoted in the workspace guide, per OS.
const params = computed(() => {
  const k = (id: string) => shortcutText(id, isMac)
  return {
    keys: k('wsNew'),
    right: k('wsSplitRight'),
    down: k('wsSplitDown'),
    focus: k('wsFocus'),
    find: k('wsFind'),
    click: isMac ? '⌘' : 'Ctrl',
    palette: keyCombo(['Mod', 'K'], isMac),
    reveal: keyCombo(['Shift', 'Enter'], isMac),
  }
})
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

let openedPanel: 'sessions' | null = null

function syncPanel(want: 'sessions' | null): boolean {
  if (openedPanel && openedPanel !== want) {
    if (ui.panels[openedPanel].open) ui.togglePanel(openedPanel)
    openedPanel = null
  }
  if (!want || ui.panels[want].open) return false
  ui.togglePanel(want)
  openedPanel = want
  return true
}

async function show(): Promise<void> {
  const opened = syncPanel(ui.tourOpen ? (step.value.panel ?? null) : null)
  await nextTick()
  const el = target()
  const reduce = reducedMotion()
  el?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  measure()
  // Smooth scrolling and the panel slide-in move the target after the first measurement.
  if (el && !reduce) window.setTimeout(measure, 350)
  else if (opened) window.setTimeout(measure, 350)
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
  if (next >= steps.value.length) return finish()
  index.value = next
  void show()
}

function finish(): void {
  markTourDone(active.value)
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
      // Anything but 'workspace' (incl. a bare `true` from older callers) is the Monitor guide.
      active.value = open === 'workspace' ? 'workspace' : 'monitor'
      ui.setView(TOURS[active.value].view)
      index.value = 0
      void show()
    } else {
      syncPanel(null)
      restoreFocus?.focus?.()
      restoreFocus = null
    }
  },
)

onMounted(() => {
  window.addEventListener('resize', measure)
  window.addEventListener('scroll', measure, true)
  mounted = true
  offerTour(ui.view)
})

// Each guide opens by itself once, the first time its view is shown (the workspace one only in the app).
let mounted = false
let offerTimer = 0
function offerTour(view: string): void {
  const id = tourFor(view, hasTerminals)
  window.clearTimeout(offerTimer)
  if (!id || tourDone(id)) return
  offerTimer = window.setTimeout(() => {
    if (!ui.tourOpen && !ui.setupOpen && !ui.whatsNewOpen && !ui.compact && ui.view === view && !tourDone(id)) ui.tourOpen = id
  }, id === 'monitor' ? 800 : 600)
}
watch(
  () => ui.view,
  (view) => mounted && offerTour(view),
)
// Quick setup goes first on a fresh install; the guide follows once it is closed.
watch(
  () => ui.setupOpen || ui.whatsNewOpen,
  (open) => mounted && !open && offerTour(ui.view),
)
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('scroll', measure, true)
  cancelAnimationFrame(frame)
  window.clearTimeout(offerTimer)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-scrim">
      <div v-if="ui.tourOpen" class="fixed inset-0 z-[60]" @keydown="onKey">
        <div v-if="!spot" class="ccm-tour-scrim absolute inset-0" />
        <div
          v-else
          class="ccm-tour-spot absolute top-0 left-0 rounded-card ring-2 ring-focus transition-[translate,width,height] duration-(--ccm-dur-slow) ease-out-quint"
          :style="{ translate: `${spot.left}px ${spot.top}px`, width: `${spot.width}px`, height: `${spot.height}px` }"
          aria-hidden="true"
        />

        <div
          ref="card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          tabindex="-1"
          class="ccm-pop ccm-sheet absolute flex flex-col gap-3 p-5 outline-none"
          :class="
            narrow
              ? 'inset-x-4 bottom-4'
              : spot
                ? 'w-[360px]'
                : 'top-1/2 left-1/2 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2'
          "
          :style="cardStyle"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-xs text-ink-faint tabular">{{ t('tour.progress', { n: index + 1, total: steps.length }) }}</p>
              <h2 id="tour-title" class="mt-0.5 text-base font-semibold">{{ text('title') }}</h2>
            </div>
            <button
              type="button"
              class="ccm-btn-plain -mt-1 -mr-1 shrink-0"
              :aria-label="t('tour.skip')"
              :title="t('tour.skip')"
              @click="finish"
            >
              <X :size="16" aria-hidden="true" />
            </button>
          </div>
          <ArtImage v-if="step.id === 'welcome'" name="tour-welcome" class="mx-auto w-36 max-w-full py-1" />
          <p id="tour-body" class="text-sm leading-relaxed text-ink-muted">{{ text('body') }}</p>
          <p v-if="step.target && !spot && step.absent" class="rounded-control bg-fill px-3 py-2 text-xs text-ink-muted">
            {{ text('absent') }}
          </p>

          <div class="flex items-center gap-2 pt-1">
            <div class="mr-auto flex gap-1" aria-hidden="true">
              <span
                v-for="(s, i) in steps"
                :key="s.id"
                class="h-1.5 rounded-full transition-[width,background-color] duration-(--ccm-dur-base) ease-out-quint"
                :class="i === index ? 'w-4 bg-accent' : i < index ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-line-strong'"
              />
            </div>
            <button
              v-if="index > 0"
              type="button"
              class="ccm-btn"
              @click="go(-1)"
            >
              <ArrowLeft :size="14" aria-hidden="true" />{{ t('tour.back') }}
            </button>
            <button
              type="button"
              class="ccm-btn ccm-btn-primary"
              @click="go(1)"
            >
              <template v-if="last"><Check :size="14" aria-hidden="true" />{{ t('tour.done') }}</template>
              <template v-else-if="index === 0">{{ t('tour.start') }}<ArrowRight :size="14" aria-hidden="true" /></template>
              <template v-else>{{ t('tour.next') }}<ArrowRight :size="14" aria-hidden="true" /></template>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ccm-tour-scrim {
  background: var(--ccm-scrim);
}
.ccm-tour-spot {
  box-shadow: 0 0 0 9999px var(--ccm-scrim);
}
</style>
