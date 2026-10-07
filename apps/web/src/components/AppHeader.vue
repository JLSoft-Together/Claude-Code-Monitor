<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Languages, Moon, Sun } from 'lucide-vue-next'
import { now, relativeTime } from '../lib/format'
import { useConnectionStore } from '../stores/connection'
import { useSettingsStore } from '../stores/settings'
import MetricsStrip from './MetricsStrip.vue'

const { t, locale } = useI18n()
const connection = useConnectionStore()
const settings = useSettingsStore()

const connectionView = computed(() => {
  switch (connection.state) {
    case 'connected':
      return { label: t('connection.connected'), glyph: 'live', cls: 'text-st-done' }
    case 'reconnecting':
      return { label: t('connection.reconnecting'), glyph: 'half', cls: 'text-st-waiting' }
    case 'connecting':
      return { label: t('connection.connecting'), glyph: 'half', cls: 'text-st-idle' }
    default:
      return { label: t('connection.disconnected'), glyph: 'ring', cls: 'text-st-error' }
  }
})

const lastUpdate = computed(() => {
  const ago = relativeTime(connection.lastEventAt, locale.value, now.value)
  return ago ? t('connection.lastUpdate', { ago }) : t('connection.never')
})
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-sm">
    <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
      <div class="flex min-w-0 items-center gap-2.5">
        <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true" class="shrink-0 text-accent">
          <path
            d="M8 1.6v12.8M1.6 8h12.8M3.5 3.5l9 9M12.5 3.5l-9 9"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <h1 class="truncate text-[15px] font-semibold tracking-tight">{{ t('app.title') }}</h1>
      </div>

      <MetricsStrip class="order-3 w-full lg:order-none lg:w-auto lg:flex-1" />

      <div class="ml-auto flex items-center gap-1.5">
        <div
          class="mr-2 flex items-center gap-2 text-xs"
          role="status"
          aria-live="polite"
          :title="connection.state !== 'connected' && connection.hasData ? t('connection.stale') : undefined"
        >
          <span class="inline-flex items-center gap-1.5 font-medium" :class="connectionView.cls">
            <span v-if="connectionView.glyph === 'live'" class="relative flex size-2">
              <span class="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping" />
              <span class="relative size-2 rounded-full bg-current" />
            </span>
            <svg v-else width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path v-if="connectionView.glyph === 'half'" d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
            </svg>
            {{ connectionView.label }}
          </span>
          <span class="hidden text-ink-faint tabular sm:inline">{{ lastUpdate }}</span>
        </div>

        <button
          type="button"
          class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-label="t('settings.language') + ': ' + t('settings.switchLanguage')"
          @click="settings.toggleLocale()"
        >
          <Languages :size="16" aria-hidden="true" />
          <span>{{ settings.locale === 'en' ? 'VI' : 'EN' }}</span>
        </button>
        <button
          type="button"
          class="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-label="settings.theme === 'dark' ? t('settings.toLight') : t('settings.toDark')"
          :title="settings.theme === 'dark' ? t('settings.toLight') : t('settings.toDark')"
          @click="settings.toggleTheme()"
        >
          <Sun v-if="settings.theme === 'dark'" :size="17" aria-hidden="true" />
          <Moon v-else :size="17" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div
      v-if="connection.state !== 'connected' && connection.hasData"
      class="border-t border-line bg-st-waiting-soft px-4 py-1.5 text-center text-xs text-st-waiting sm:px-6"
    >
      {{ t('connection.stale') }}
    </div>
  </header>
</template>
