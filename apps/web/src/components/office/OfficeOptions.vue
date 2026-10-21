<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SlidersHorizontal } from 'lucide-vue-next'
import type { WorldOptions } from '@ccm/habblaud/client/src/world/api'
import { retireOverlay } from '../../lib/motion'
import { BUBBLES, LIVELINESS, useOfficeStore } from '../../stores/office'
import ToggleSwitch from '../ToggleSwitch.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'

const { t } = useI18n()
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
watch(open, listen)
onBeforeUnmount(() => listen(false))

const showNames = computed({ get: () => office.options.showNames, set: (v: boolean) => office.setOption('showNames', v) })
const dayNight = computed({ get: () => office.options.dayNight, set: (v: boolean) => office.setOption('dayNight', v) })
const followSelected = computed({ get: () => office.options.followSelected, set: (v: boolean) => office.setOption('followSelected', v) })
const bubbles = computed({ get: () => office.options.bubbles, set: (v: WorldOptions['bubbles']) => office.setOption('bubbles', v) })
const liveliness = computed({ get: () => office.options.liveliness, set: (v: WorldOptions['liveliness']) => office.setOption('liveliness', v) })

const BUBBLE_KEYS = { all: 'bubblesAll', important: 'bubblesImportant', none: 'bubblesNone' } as const
const bubbleOptions = computed(() => BUBBLES.map((value) => ({ value, label: t(`officeV60.options.${BUBBLE_KEYS[value]}`) })))
const livelinessOptions = computed(() => LIVELINESS.map((value) => ({ value, label: t(`officeV60.options.${value}`) })))
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
