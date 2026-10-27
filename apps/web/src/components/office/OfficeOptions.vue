<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Building2, Check, SlidersHorizontal } from 'lucide-vue-next'
import type { WorldOptions } from '@ccm/habblaud/client/src/world/api'
import { retireOverlay } from '../../lib/motion'
import { CLASSIC_PACK } from '../../office/packs'
import { OFFICE_STYLES, type OfficeStyle } from '../../office/iso'
import { BUBBLES, LIVELINESS, SEASONAL_THEMES, useOfficeStore } from '../../stores/office'
import ToggleSwitch from '../ToggleSwitch.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'

const { t, locale } = useI18n()
const office = useOfficeStore()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)

function onOutside(e: PointerEvent): void {
  if (!root.value?.contains(e.target as Node)) open.value = false
}
// Capture phase: Escape closes the popover before the Monitor shortcuts clear the selection.
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  open.value = false
  trigger.value?.focus()
}
function listen(on: boolean): void {
  const fn = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document)
  fn('pointerdown', onOutside as EventListener, true)
  fn('keydown', onKey as EventListener, true)
}
watch(open, (on) => {
  listen(on)
  if (on) {
    void office.loadPacks()
    office.noteIsoIntent()
  }
})
onBeforeUnmount(() => listen(false))

const showNames = computed({ get: () => office.options.showNames, set: (v: boolean) => office.setOption('showNames', v) })
const dayNight = computed({ get: () => office.options.dayNight, set: (v: boolean) => office.setOption('dayNight', v) })
const followSelected = computed({ get: () => office.options.followSelected, set: (v: boolean) => office.setOption('followSelected', v) })
const bubbles = computed({ get: () => office.options.bubbles, set: (v: WorldOptions['bubbles']) => office.setOption('bubbles', v) })
const liveliness = computed({ get: () => office.options.liveliness, set: (v: WorldOptions['liveliness']) => office.setOption('liveliness', v) })

const officeStyle = computed({ get: () => office.style, set: (v: OfficeStyle) => office.setStyle(v) })
const styleOptions = computed(() => OFFICE_STYLES.map((value) => ({ value, label: t(`officeV63.style.${value}`) })))

const BUBBLE_KEYS = { all: 'bubblesAll', important: 'bubblesImportant', none: 'bubblesNone' } as const
const bubbleOptions = computed(() => BUBBLES.map((value) => ({ value, label: t(`officeV60.options.${BUBBLE_KEYS[value]}`) })))
const livelinessOptions = computed(() => LIVELINESS.map((value) => ({ value, label: t(`officeV60.options.${value}`) })))

const seasonal = computed({ get: () => office.options.theme ?? 'auto', set: (v: NonNullable<WorldOptions['theme']>) => office.setOption('theme', v) })
const seasonalOptions = computed(() => SEASONAL_THEMES.map((value) => ({ value: value ?? 'auto', label: t(`officeV62.seasonal.${value ?? 'auto'}`) })))

const packCards = computed(() => [
  { id: CLASSIC_PACK, name: t('officeV62.pack.classic'), preview: null as string | null },
  ...office.packs.map((p) => ({ id: p.id, name: locale.value === 'vi' ? p.name.vi : p.name.en, preview: p.preview })),
])
const brokenPreview = ref(new Set<string>())
function onPreviewError(id: string): void {
  brokenPreview.value = new Set(brokenPreview.value).add(id)
}
const missingName = computed(() => {
  const id = office.packMissing
  if (!id) return null
  return packCards.value.find((c) => c.id === id)?.name ?? id
})
const packGroup = ref<HTMLElement | null>(null)
function onPackKey(e: KeyboardEvent): void {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const cards = packCards.value
  const at = Math.max(0, cards.findIndex((c) => c.id === office.activePack))
  const next = (at + step + cards.length) % cards.length
  office.setPack(cards[next]!.id)
  packGroup.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
}
</script>

<template>
  <div ref="root" class="relative flex" data-office-options>
    <button
      ref="trigger"
      type="button"
      class="ccm-btn-plain ccm-press text-xs"
      :class="open ? 'bg-fill text-ink' : ''"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-label="t('officeV60.options.label')"
      :title="t('officeV60.options.label')"
      @click="open = !open"
    >
      <SlidersHorizontal :size="16" aria-hidden="true" />
    </button>

    <Transition name="ccm-menu" @before-leave="retireOverlay">
      <div
        v-if="open"
        role="dialog"
        :aria-label="t('officeV60.options.label')"
        class="ccm-menu absolute top-full right-0 z-40 mt-2 w-[min(340px,calc(100vw-32px))] [--ccm-origin:top_right]"
      >
        <p class="px-3 pt-2 pb-1 text-sm font-semibold text-ink">{{ t('officeV60.options.title') }}</p>
        <div class="px-3 py-2" data-office-style @pointerenter="office.noteIsoIntent()" @focusin="office.noteIsoIntent()">
          <p class="text-sm text-ink">{{ t('officeV63.style.label') }}</p>
          <p class="mt-0.5 mb-1.5 text-2xs text-ink-faint">{{ t('officeV63.style.hint') }}</p>
          <SegmentedControl v-model="officeStyle" :options="styleOptions" :label="t('officeV63.style.label')" :disabled="office.switching" fill />
          <Transition name="ccm-swap">
            <p v-if="office.style === 'iso' && office.isoArtMissing" class="mt-1.5 text-2xs text-ink-muted" role="status" data-office-style-missing>{{ t('officeV63.style.missing') }}</p>
          </Transition>
        </div>
        <div class="px-3 py-2" data-office-packs>
          <p class="text-sm text-ink">{{ t('officeV62.pack.label') }}</p>
          <p class="mt-0.5 mb-1.5 text-2xs text-ink-faint">{{ t('officeV62.pack.hint') }}</p>
          <div ref="packGroup" role="radiogroup" :aria-label="t('officeV62.pack.label')" class="grid grid-cols-3 gap-1.5" @keydown="onPackKey">
            <button
              v-for="c in packCards"
              :key="c.id"
              type="button"
              role="radio"
              :aria-checked="office.activePack === c.id"
              :tabindex="office.activePack === c.id ? 0 : -1"
              :title="c.name"
              :data-office-pack="c.id"
              class="ccm-press group flex min-w-0 cursor-pointer flex-col gap-1 rounded-control p-1 text-left transition-colors duration-150 hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
              @click="office.setPack(c.id)"
            >
              <span
                class="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[5px] bg-fill ring-1 transition-[box-shadow,color] duration-200"
                :class="office.activePack === c.id ? 'ring-2 ring-accent' : 'ring-line'"
              >
                <img
                  v-if="c.preview && !brokenPreview.has(c.id)"
                  :src="c.preview"
                  alt=""
                  class="h-full w-full object-cover [image-rendering:pixelated]"
                  draggable="false"
                  @error="onPreviewError(c.id)"
                />
                <Building2 v-else :size="18" class="text-ink-faint" aria-hidden="true" />
                <Transition name="ccm-swap">
                  <span v-if="office.activePack === c.id" class="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-on-accent">
                    <Check :size="11" :stroke-width="3" aria-hidden="true" />
                  </span>
                </Transition>
              </span>
              <span class="truncate text-2xs" :class="office.activePack === c.id ? 'font-medium text-ink' : 'text-ink-muted'">{{ c.name }}</span>
            </button>
          </div>
          <Transition name="ccm-swap">
            <p v-if="missingName" class="mt-1.5 text-2xs text-ink-muted" role="status" data-office-pack-missing>{{ t('officeV62.pack.unavailable', { name: missingName }) }}</p>
          </Transition>
        </div>
        <div class="px-3 py-2">
          <p class="text-sm text-ink">{{ t('officeV62.seasonal.label') }}</p>
          <p class="mt-0.5 mb-1.5 text-2xs text-ink-faint">{{ t('officeV62.seasonal.hint') }}</p>
          <SegmentedControl v-model="seasonal" :options="seasonalOptions" :label="t('officeV62.seasonal.label')" fill />
        </div>
        <ToggleSwitch v-model="showNames" :label="t('officeV60.options.showNames')" :hint="t('officeV60.options.showNamesHint')" class="px-3" />
        <div class="px-3 py-2">
          <p class="mb-1.5 text-sm text-ink">{{ t('officeV60.options.bubbles') }}</p>
          <SegmentedControl v-model="bubbles" :options="bubbleOptions" :label="t('officeV60.options.bubbles')" fill />
        </div>
        <div class="px-3 py-2">
          <p class="text-sm text-ink">{{ t('officeV60.options.liveliness') }}</p>
          <p class="mt-0.5 mb-1.5 text-2xs text-ink-faint">{{ t('officeV60.options.livelinessHint') }}</p>
          <SegmentedControl v-model="liveliness" :options="livelinessOptions" :label="t('officeV60.options.liveliness')" fill />
        </div>
        <ToggleSwitch v-model="dayNight" :label="t('officeV60.options.dayNight')" :hint="t('officeV60.options.dayNightHint')" class="px-3" />
        <ToggleSwitch v-model="followSelected" :label="t('officeV60.options.followSelected')" :hint="t('officeV60.options.followSelectedHint')" class="px-3" />
      </div>
    </Transition>
  </div>
</template>
