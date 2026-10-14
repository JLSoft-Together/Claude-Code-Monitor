<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Lightbulb, X } from 'lucide-vue-next'
import { isMac } from '../../lib/platform'
import { tipKeys } from '../../lib/tips'
import { useTipsStore } from '../../stores/tips'

const props = defineProps<{ visible: boolean }>()

const { t } = useI18n()
const tips = useTipsStore()
const HIDE_MS = 10_000
const hovering = ref(false)
let timer = 0

const text = computed(() => (tips.current ? t(`tips.${tips.current}`, tipKeys(tips.current, isMac)) : ''))

function arm(): void {
  window.clearTimeout(timer)
  if (tips.current && !hovering.value) timer = window.setTimeout(() => tips.dismiss(), HIDE_MS)
}

// Paused while the pointer or focus is on it, so reading it never races the timer.
function hold(on: boolean): void {
  hovering.value = on
  arm()
}

watch(() => tips.current, arm)
watch(
  () => props.visible,
  (shown) => {
    if (!shown) tips.dismiss()
  },
)
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <Transition
    enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
    enter-from-class="opacity-0 translate-y-3"
    leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
    leave-to-class="opacity-0 translate-y-2"
  >
    <aside
      v-if="visible && tips.current"
      role="status"
      aria-live="polite"
      :aria-label="t('tips.label')"
      data-shortcut-tip
      class="ccm-sheet fixed right-4 bottom-4 z-40 flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2.5 p-3.5"
      @pointerenter="hold(true)"
      @pointerleave="hold(false)"
      @focusin="hold(true)"
      @focusout="hold(false)"
    >
      <div class="flex items-start gap-2.5">
        <Lightbulb :size="16" class="mt-0.5 shrink-0 text-favorite" aria-hidden="true" />
        <p class="min-w-0 flex-1 text-sm leading-relaxed text-ink">
          <span class="font-semibold">{{ t('tips.label') }}:</span> {{ text }}
        </p>
        <button type="button" class="ccm-btn-plain -mt-1 -mr-1 shrink-0" :aria-label="t('tips.gotIt')" @click="tips.dismiss()">
          <X :size="15" aria-hidden="true" />
        </button>
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" class="ccm-btn" @click="tips.setOff(true)">{{ t('tips.off') }}</button>
        <button type="button" class="ccm-btn ccm-btn-primary" @click="tips.dismiss()">{{ t('tips.gotIt') }}</button>
      </div>
    </aside>
  </Transition>
</template>
