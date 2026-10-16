<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SunDim } from 'lucide-vue-next'
import { hasTerminals } from '../../lib/desktop'
import { tourDone } from '../../lib/tour'
import { useTipsStore } from '../../stores/tips'
import { useUiStore } from '../../stores/ui'

const props = defineProps<{ on: boolean; visible: boolean }>()
const emit = defineEmits<{ toggle: [] }>()

const { t } = useI18n()
const tips = useTipsStore()
const ui = useUiStore()

const TIP_KEY = 'ccm.workspace.dimTip'
const TIP_DELAY_MS = 900
const root = ref<HTMLElement | null>(null)
const tipOpen = ref(false)
let timer = 0

const label = computed(() => t(props.on ? 'workspace.dim.toggleOn' : 'workspace.dim.toggle'))

function seen(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === '1'
  } catch {
    return true
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(TIP_KEY, '1')
  } catch {
    return
  }
}

const allowed = (): boolean => props.visible && !props.on && !seen() && !tips.state.off && !ui.tourOpen && (!hasTerminals || tourDone('workspace'))

function offer(): void {
  window.clearTimeout(timer)
  if (!allowed()) return
  timer = window.setTimeout(() => {
    if (allowed()) tipOpen.value = true
  }, TIP_DELAY_MS)
}

function close(): void {
  tipOpen.value = false
  markSeen()
}

function tryIt(): void {
  close()
  if (!props.on) emit('toggle')
}

function onOutside(e: PointerEvent): void {
  if (!root.value?.contains(e.target as Node)) close()
}

watch(
  () => props.visible,
  (shown) => {
    if (shown) return offer()
    window.clearTimeout(timer)
    tipOpen.value = false
  },
  { immediate: true },
)
watch(
  () => props.on,
  (on) => {
    if (on && tipOpen.value) close()
  },
)
watch(
  () => ui.tourOpen,
  (open) => {
    if (!open) return offer()
    window.clearTimeout(timer)
    tipOpen.value = false
  },
)
watch(tipOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onOutside, true)
  else document.removeEventListener('pointerdown', onOutside, true)
})
onBeforeUnmount(() => {
  window.clearTimeout(timer)
  document.removeEventListener('pointerdown', onOutside, true)
})
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      type="button"
      class="ccm-btn-plain"
      :class="on || tipOpen ? 'text-accent-ink!' : ''"
      :aria-pressed="on"
      :aria-label="label"
      :title="`${label}\n${t('workspace.dim.hint')}`"
      data-dim-toggle
      @click="emit('toggle')"
    >
      <SunDim :size="16" aria-hidden="true" />
    </button>
    <Transition
      enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
      leave-to-class="opacity-0"
    >
      <div
        v-if="tipOpen"
        class="ccm-sheet absolute top-[calc(100%+3rem)] right-0 z-40 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-1 p-3"
        role="status"
        aria-live="polite"
        data-dim-tip
        @keydown.esc.stop.prevent="close()"
      >
        <p class="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <SunDim :size="14" class="shrink-0 text-accent-ink" aria-hidden="true" />{{ t('workspace.dim.tipTitle') }}
        </p>
        <p class="text-xs leading-relaxed text-ink-muted">{{ t('workspace.dim.tipBody') }}</p>
        <div class="mt-2 flex justify-end gap-2">
          <button type="button" class="ccm-btn" data-dim-later @click="close()">{{ t('workspace.dim.tipLater') }}</button>
          <button type="button" class="ccm-btn ccm-btn-primary" data-dim-try @click="tryIt()">{{ t('workspace.dim.tipTry') }}</button>
        </div>
      </div>
    </Transition>
  </div>
</template>
