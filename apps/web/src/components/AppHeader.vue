<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, ChartColumnBig, History, Languages, Moon, Search, Sun } from 'lucide-vue-next'
import { now, relativeTime } from '../lib/format'
import { useConnectionStore } from '../stores/connection'
import { useSettingsStore } from '../stores/settings'
import { useUiStore, type View } from '../stores/ui'
import PlanLimits from './PlanLimits.vue'
import SettingsMenu from './SettingsMenu.vue'

const { t, locale } = useI18n()
const connection = useConnectionStore()
const settings = useSettingsStore()
const ui = useUiStore()

const tabs = computed(() => [
  { id: 'monitor' as View, label: t('nav.monitor'), icon: Activity },
  { id: 'usage' as View, label: t('nav.usage'), icon: ChartColumnBig },
  { id: 'history' as View, label: t('nav.history'), icon: History },
])
const activeIndex = computed(() => tabs.value.findIndex((x) => x.id === ui.view))

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

function toggleTheme(): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (doc.startViewTransition && !reduce) doc.startViewTransition(() => settings.toggleTheme())
  else settings.toggleTheme()
}

function onTabKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  e.preventDefault()
  const next = (activeIndex.value + (e.key === 'ArrowRight' ? 1 : -1) + tabs.value.length) % tabs.value.length
  ui.setView(tabs.value[next]!.id)
  ;(e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
}
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-sm">
    <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
      <div class="flex min-w-0 items-center gap-3">
        <ArtImage name="logo" class="size-9 shrink-0" />
        <h1 class="truncate text-base font-semibold tracking-tight sm:text-lg">{{ t('app.title') }}</h1>
      </div>

      <div
        role="tablist"
        :aria-label="t('nav.label')"
        class="relative order-3 grid w-full grid-cols-3 rounded-xl border border-line bg-surface p-1 sm:order-none sm:w-auto"
      >
        <span
          class="absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-lg bg-accent-soft transition-transform duration-300 ease-out-quint"
          :style="{ transform: `translateX(${activeIndex * 100}%)` }"
          aria-hidden="true"
        />
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="ui.view === tab.id"
          :tabindex="ui.view === tab.id ? 0 : -1"
          class="relative inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors sm:min-w-[120px]"
          :class="ui.view === tab.id ? 'text-accent' : 'text-ink-muted hover:text-ink'"
          @click="ui.setView(tab.id)"
          @keydown="onTabKey"
        >
          <component :is="tab.icon" :size="17" aria-hidden="true" />
          {{ tab.label }}
        </button>
      </div>

      <div class="ml-auto flex items-center gap-1.5">
        <PlanLimits class="mr-1 sm:mr-3" />
        <div
          class="mr-2 flex items-center gap-2 text-xs"
          role="status"
          aria-live="polite"
          :title="connection.state !== 'connected' && connection.hasData ? t('connection.stale') : undefined"
        >
          <span class="inline-flex items-center gap-1.5 font-medium" :class="connectionView.cls">
            <span v-if="connectionView.glyph === 'live'" class="relative flex size-2.5">
              <span class="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping" />
              <span class="relative size-2.5 rounded-full bg-current" />
            </span>
            <svg v-else width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path v-if="connectionView.glyph === 'half'" d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
            </svg>
            {{ connectionView.label }}
          </span>
          <span class="hidden text-ink-faint tabular md:inline">{{ lastUpdate }}</span>
        </div>

        <button
          type="button"
          class="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-label="t('palette.open')"
          :title="t('palette.open')"
          aria-keyshortcuts="Control+K"
          @click="ui.paletteOpen = true"
        >
          <Search :size="17" aria-hidden="true" />
          <kbd class="hidden rounded border border-line px-1 font-mono text-2xs text-ink-faint lg:inline">Ctrl K</kbd>
        </button>
        <button
          type="button"
          class="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-label="t('settings.language') + ': ' + t('settings.switchLanguage')"
          @click="settings.toggleLocale()"
        >
          <Languages :size="17" aria-hidden="true" />
          <span>{{ settings.locale === 'en' ? 'VI' : 'EN' }}</span>
        </button>
        <button
          type="button"
          class="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-label="settings.theme === 'dark' ? t('settings.toLight') : t('settings.toDark')"
          :title="settings.theme === 'dark' ? t('settings.toLight') : t('settings.toDark')"
          @click="toggleTheme"
        >
          <Transition
            mode="out-in"
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 rotate-[-60deg] scale-75"
            leave-active-class="transition duration-100 ease-in"
            leave-to-class="opacity-0 rotate-[60deg] scale-75"
          >
            <Sun v-if="settings.theme === 'dark'" key="sun" :size="18" aria-hidden="true" />
            <Moon v-else key="moon" :size="18" aria-hidden="true" />
          </Transition>
        </button>
        <SettingsMenu />
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
