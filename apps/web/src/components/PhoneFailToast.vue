<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert, X } from 'lucide-vue-next'
import type { PhoneError } from '@ccm/shared'
import { onPhone } from '../lib/phone'
import { useUiStore } from '../stores/ui'

/** One in-app notice per run of failed phone sends (desktop main reports only the first failure). */
const { t } = useI18n()
const ui = useUiStore()
const error = ref<PhoneError | null>(null)

const off = onPhone((e) => {
  if ('failed' in e) error.value = e.failed
})
onBeforeUnmount(off)

function openSettings(): void {
  error.value = null
  ui.settingsOpen = true
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
    enter-from-class="opacity-0 translate-y-3"
    leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
    leave-to-class="opacity-0 translate-y-2"
  >
    <aside v-if="error" role="status" aria-live="polite" aria-labelledby="phone-fail-title" class="ccm-sheet fixed right-4 bottom-4 z-40 w-[min(340px,calc(100vw-2rem))] p-3.5" data-phone-fail>
      <div class="flex items-start gap-2.5">
        <TriangleAlert :size="16" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <h2 id="phone-fail-title" class="text-sm font-semibold">{{ t('phone.failTitle') }}</h2>
          <p class="mt-0.5 text-xs leading-relaxed text-ink-muted">{{ t(`phone.error.${error}`) }}</p>
        </div>
        <button type="button" class="ccm-btn-plain -mt-1 -mr-1 shrink-0" :aria-label="t('phone.dismiss')" @click="error = null">
          <X :size="15" aria-hidden="true" />
        </button>
      </div>
      <div class="mt-2.5 flex justify-end">
        <button type="button" class="ccm-btn" @click="openSettings">{{ t('phone.openSettings') }}</button>
      </div>
    </aside>
  </Transition>
</template>
