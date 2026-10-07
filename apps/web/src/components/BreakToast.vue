<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CupSoda, X } from 'lucide-vue-next'
import { BREAK_MINUTES, breakAnchor, nextBreakAt } from '../lib/breaks'
import { now } from '../lib/format'
import { useExtrasStore } from '../stores/extras'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const { t, locale } = useI18n()
const ui = useUiStore()
const extras = useExtrasStore()
const settings = useSettingsStore()

const clock = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }))
const anchor = computed(() => breakAnchor(extras.dayStartedAt, now.value))
const since = computed(() => (anchor.value === null ? null : clock.value.format(anchor.value)))
const next = computed(() => (anchor.value === null ? null : clock.value.format(nextBreakAt(anchor.value, now.value))))
const worked = computed(() => {
  const m = ui.breakDue?.minutes ?? 0
  return m >= 60 ? t('breaks.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('breaks.m', { m })
})

function dismiss(): void {
  ui.breakDue = null
}

function turnOff(): void {
  settings.breakReminder = false
  dismiss()
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out-quint motion-reduce:transition-none"
    enter-from-class="opacity-0 translate-y-3"
    leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
    leave-to-class="opacity-0 translate-y-2"
  >
    <aside
      v-if="ui.breakDue"
      role="status"
      aria-live="polite"
      aria-labelledby="break-title"
      class="fixed right-4 bottom-4 z-40 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-4 shadow-lg"
    >
      <div class="flex items-start gap-3">
        <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
          <CupSoda :size="20" class="motion-safe:animate-[ccm-sip_1.6s_ease-in-out_2]" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 id="break-title" class="text-sm font-semibold">{{ t('breaks.title') }}</h2>
          <p class="mt-1 text-sm leading-relaxed text-ink-muted">{{ t('breaks.body', { n: BREAK_MINUTES }) }}</p>
          <p v-if="since" class="mt-1.5 text-xs text-ink-faint tabular">{{ t('breaks.since', { since, worked }) }}</p>
        </div>
        <button
          type="button"
          class="-mt-1 -mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-label="t('breaks.dismiss')"
          @click="dismiss"
        >
          <X :size="16" aria-hidden="true" />
        </button>
      </div>
      <div class="mt-3 flex items-center gap-2">
        <span v-if="next" class="mr-auto text-xs text-ink-faint tabular">{{ t('breaks.next', { at: next }) }}</span>
        <button
          type="button"
          class="inline-flex h-8 cursor-pointer items-center rounded-lg px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          @click="turnOff"
        >
          {{ t('breaks.off') }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 cursor-pointer items-center rounded-lg bg-accent px-3 text-xs font-medium text-on-accent transition-opacity hover:opacity-90"
          @click="dismiss"
        >
          {{ t('breaks.done') }}
        </button>
      </div>
    </aside>
  </Transition>
</template>
