<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Type, ZoomIn } from 'lucide-vue-next'
import { zoomHud } from '../composables/useWheelZoom'

const { t } = useI18n()
const shown = ref(false)
let timer = 0

watch(zoomHud, (h) => {
  if (!h) return
  shown.value = true
  window.clearTimeout(timer)
  timer = window.setTimeout(() => (shown.value = false), 1200)
})
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <!-- Live region stays mounted so screen readers announce each new value. -->
  <div class="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center" role="status" aria-live="polite" aria-atomic="true">
    <Transition
      enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
      enter-from-class="opacity-0 translate-y-1"
      leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
      leave-to-class="opacity-0"
    >
      <p
        v-if="shown && zoomHud"
        :key="zoomHud.kind"
        class="ccm-material-pop inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink shadow-pop tabular"
        data-zoom-hud
      >
        <component :is="zoomHud.kind === 'code' ? Type : ZoomIn" :size="13" class="text-ink-muted" aria-hidden="true" />
        {{ zoomHud.kind === 'code' ? t('zoom.code', { n: zoomHud.value }) : t('zoom.app', { n: zoomHud.value }) }}
      </p>
    </Transition>
  </div>
</template>
