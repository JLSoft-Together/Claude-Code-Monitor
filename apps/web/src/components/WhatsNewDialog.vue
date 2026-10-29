<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Sparkles, X } from 'lucide-vue-next'
import { APP_VERSION, CHANGELOG, markSeen, seenVersion, shouldShowWhatsNew, type Release } from '../lib/changelog'
import { hasTerminals } from '../lib/desktop'
import { retireOverlay } from '../lib/motion'
import { tourDone, tourFor } from '../lib/tour'
import { useUiStore } from '../stores/ui'

const { t, locale } = useI18n()
const ui = useUiStore()
const dialog = ref<HTMLElement | null>(null)
const expanded = ref(new Set<string>())
let restoreFocus: HTMLElement | null = null

const subtitle = computed(() => t('whatsNew.subtitle', { version: APP_VERSION }))
const allOpen = computed(() => expanded.value.size === CHANGELOG.length)
const text = (item: Release['items'][number]): string => (locale.value === 'vi' ? item.vi : item.en)
const dateOf = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
}

function toggle(version: string): void {
  const next = new Set(expanded.value)
  if (!next.delete(version)) next.add(version)
  expanded.value = next
}

function toggleAll(): void {
  expanded.value = allOpen.value ? new Set() : new Set(CHANGELOG.map((r) => r.version))
}

function close(): void {
  ui.whatsNewOpen = false
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(
  () => ui.whatsNewOpen,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      const current = CHANGELOG.some((r) => r.version === APP_VERSION) ? APP_VERSION : CHANGELOG[0]?.version
      expanded.value = new Set(current ? [current] : [])
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('[data-whats-new-current]')?.focus()
    } else {
      markSeen()
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
)

// On a fresh install quick setup and the view's guide go first; the dialog waits until neither is open or due.
function tourDue(): boolean {
  if (ui.compact) return false
  const id = tourFor(ui.view, hasTerminals)
  return !!id && !tourDone(id)
}
const blocked = (): boolean => ui.whatsNewOpen || ui.setupOpen || !!ui.tourOpen || tourDue()
let offered = false
let timer = 0
function offer(): void {
  window.clearTimeout(timer)
  if (offered || !shouldShowWhatsNew(seenVersion(), APP_VERSION)) return
  timer = window.setTimeout(() => {
    if (offered || blocked()) return
    offered = true
    ui.whatsNewOpen = true
  }, 1200)
}
watch(() => [ui.setupOpen, ui.tourOpen, ui.view, ui.compact], offer)
onMounted(offer)
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="ui.whatsNewOpen" class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-4 py-[6vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="whats-new-title"
          class="flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden ccm-sheet"
          data-whats-new
          @keydown="trap"
        >
          <div class="flex shrink-0 items-center gap-2 border-b border-line py-3 pr-3 pl-5">
            <Sparkles :size="16" class="shrink-0 text-accent-ink" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="whats-new-title" class="truncate text-base font-semibold">{{ t('whatsNew.title') }}</h2>
              <p class="truncate text-2xs text-ink-muted">{{ subtitle }}</p>
            </div>
            <button type="button" class="ccm-btn shrink-0" :aria-pressed="allOpen" @click="toggleAll">
              {{ allOpen ? t('whatsNew.collapseAll') : t('whatsNew.expandAll') }}
            </button>
            <button type="button" class="ccm-btn-plain shrink-0" :title="t('whatsNew.close')" :aria-label="t('whatsNew.close')" @click="close">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto bg-canvas px-3 py-3 sm:px-5">
            <ul class="ccm-group overflow-hidden">
              <li v-for="r in CHANGELOG" :key="r.version" class="border-b border-line last:border-b-0">
                <button
                  :id="`whats-new-h-${r.version}`"
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-fill"
                  :aria-expanded="expanded.has(r.version)"
                  :aria-controls="`whats-new-p-${r.version}`"
                  :data-whats-new-current="r.version === APP_VERSION || undefined"
                  @click="toggle(r.version)"
                >
                  <ChevronRight
                    :size="14"
                    class="shrink-0 text-ink-faint transition-transform duration-200 motion-reduce:transition-none"
                    :class="expanded.has(r.version) && 'rotate-90'"
                    aria-hidden="true"
                  />
                  <span class="shrink-0 text-sm font-semibold tabular-nums">{{ r.version }}</span>
                  <span
                    v-if="r.version === APP_VERSION"
                    class="shrink-0 rounded-full bg-fill px-1.5 py-px text-2xs font-medium text-accent-ink"
                  >{{ t('whatsNew.current') }}</span>
                  <span class="min-w-0 flex-1 truncate text-2xs text-ink-faint">{{ dateOf(r.date) }}</span>
                  <span class="shrink-0 text-2xs text-ink-faint tabular-nums">{{ t('whatsNew.changes', { n: r.items.length }, r.items.length) }}</span>
                </button>
                <div
                  :id="`whats-new-p-${r.version}`"
                  role="region"
                  :aria-labelledby="`whats-new-h-${r.version}`"
                  class="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
                  :class="expanded.has(r.version) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
                  :inert="!expanded.has(r.version)"
                >
                  <div class="min-h-0 overflow-hidden">
                    <ul class="list-disc space-y-1 pt-0.5 pr-3 pb-2.5 pl-11 text-sm text-ink marker:text-ink-faint">
                      <li v-for="(item, i) in r.items" :key="i" class="break-words">{{ text(item) }}</li>
                    </ul>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
