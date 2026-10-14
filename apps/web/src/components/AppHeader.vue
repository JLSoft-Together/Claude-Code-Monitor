<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, ChartColumnBig, History, Languages, Maximize2, Minimize2, Moon, Search, SquareTerminal, Sun } from 'lucide-vue-next'
import { hasTerminals } from '../lib/desktop'
import { now, relativeTime } from '../lib/format'
import { withViewTransition } from '../lib/motion'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useSettingsStore } from '../stores/settings'
import { useUiStore, type View } from '../stores/ui'
import FlipClock from './FlipClock.vue'
import PlanLimits from './PlanLimits.vue'
import SettingsMenu from './SettingsMenu.vue'

const { t, locale } = useI18n()
const connection = useConnectionStore()
const extras = useExtrasStore()
const settings = useSettingsStore()
const ui = useUiStore()

const tabs = computed(() => [
  { id: 'monitor' as View, label: t('nav.monitor'), icon: Activity },
  ...(hasTerminals ? [{ id: 'workspace' as View, label: t('nav.workspace'), icon: SquareTerminal }] : []),
  { id: 'usage' as View, label: t('nav.usage'), icon: ChartColumnBig },
  { id: 'history' as View, label: t('nav.history'), icon: History },
])
const titleChars = computed(() => [...t('app.title')])
// Brand words ("Agent") take the accent; the last word stays in ink.
const accentUntil = computed(() => t('app.title').lastIndexOf(' '))

const activeIndex = computed(() => tabs.value.findIndex((x) => x.id === ui.view))

const connectionView = computed(() => {
  switch (connection.state) {
    case 'connected':
      return { label: t('connection.connected'), glyph: 'live', cls: 'text-success' }
    case 'reconnecting':
      return { label: t('connection.reconnecting'), glyph: 'half', cls: 'text-warning' }
    case 'connecting':
      return { label: t('connection.connecting'), glyph: 'half', cls: 'text-st-idle' }
    default:
      return { label: t('connection.disconnected'), glyph: 'ring', cls: 'text-st-error' }
  }
})

// Every label stacks in one grid cell so the status keeps the widest width and nothing beside it shifts.
const connectionLabels = computed(() => ['connected', 'connecting', 'reconnecting', 'disconnected'].map((k) => t(`connection.${k}`)))

const lastUpdate = computed(() => {
  const ago = relativeTime(connection.lastEventAt, locale.value, now.value)
  return ago ? t('connection.lastUpdate', { ago }) : t('connection.never')
})
const connectionTitle = computed(() =>
  connection.state !== 'connected' && connection.hasData ? t('connection.stale') : `${connectionView.value.label}. ${lastUpdate.value}`,
)

const showClaudeLimits = computed(() => !!(extras.limits?.fiveHour || extras.limits?.sevenDay))
const showCodexLimits = computed(() => !!(extras.codexLimits?.fiveHour || extras.codexLimits?.sevenDay))

function toggleTheme(): void {
  withViewTransition(() => settings.toggleTheme())
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
  <header class="ccm-material sticky top-0 z-30 border-b border-line">
    <div class="flex min-h-13 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-1.5 sm:px-5">
      <div class="flex min-w-0 shrink-0 items-center gap-2.5">
        <ArtImage name="logo" class="size-8 shrink-0" />
        <div class="flex min-w-0 flex-col">
          <h1 class="ccm-title min-w-0 truncate text-sm leading-tight font-semibold tracking-tight sm:text-base" :aria-label="t('app.title')">
            <span aria-hidden="true"
              ><span
                v-for="(c, i) in titleChars"
                :key="i"
                class="ccm-title-char"
                :class="i < accentUntil ? 'text-accent-ink' : 'text-ink'"
                :style="{ '--i': i }"
                >{{ c }}</span
              ><span class="ccm-caret ml-0.5 inline-block h-[0.9em] w-[0.42em] translate-y-[0.1em] rounded-[1px] bg-accent"
            /></span>
          </h1>
          <FlipClock class="mt-0.5 hidden sm:flex" />
        </div>
      </div>

      <div
        v-if="!ui.compact"
        data-tour="tabs"
        role="tablist"
        :aria-label="t('nav.label')"
        class="relative order-3 grid w-full shrink-0 auto-cols-fr grid-flow-col rounded-control bg-fill p-0.5 sm:order-none sm:w-auto"
      >
        <span
          class="absolute inset-y-0.5 left-0.5 rounded-inner bg-control shadow-control transition-transform duration-(--ccm-dur-slow) ease-spring"
          :style="{ width: `calc((100% - 4px) / ${tabs.length})`, transform: `translateX(${activeIndex * 100}%)` }"
          aria-hidden="true"
        />
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="ui.view === tab.id"
          :tabindex="ui.view === tab.id ? 0 : -1"
          class="relative inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-inner px-3 text-xs font-medium transition-colors sm:min-w-[104px]"
          :class="ui.view === tab.id ? 'text-ink' : 'text-ink-muted hover:text-ink'"
          @click="ui.setView(tab.id)"
          @keydown="onTabKey"
        >
          <component :is="tab.icon" :size="15" aria-hidden="true" />
          {{ tab.label }}
        </button>
      </div>

      <!-- wrap-reverse: when the row runs out of room the quota cluster drops below the controls instead of overlapping the tabs. -->
      <div class="flex flex-1 flex-wrap-reverse items-center justify-end gap-x-4 gap-y-2">
        <div
          v-if="showClaudeLimits || showCodexLimits"
          data-tour="limits"
          class="flex flex-wrap items-stretch gap-0.5 rounded-control bg-surface p-0.5 shadow-card sm:flex-nowrap"
        >
          <PlanLimits v-if="showClaudeLimits" />
          <span v-if="showClaudeLimits && showCodexLimits" class="my-1.5 hidden w-px shrink-0 bg-line sm:block" aria-hidden="true" />
          <PlanLimits v-if="showCodexLimits" provider="codex" />
        </div>

        <div class="flex flex-wrap items-center justify-end gap-1 sm:flex-nowrap">
          <div class="mr-1 flex shrink-0 items-center px-1 text-xs whitespace-nowrap" role="status" aria-live="polite" :title="connectionTitle">
            <span class="inline-flex items-center gap-1.5 font-medium" :class="connectionView.cls">
              <span v-if="connectionView.glyph === 'live'" class="relative flex size-2.5">
                <span class="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping" />
                <span class="relative size-2.5 rounded-full bg-current" />
              </span>
              <svg v-else width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8" />
                <path v-if="connectionView.glyph === 'half'" d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
              </svg>
              <span class="grid" :class="connection.state === 'connected' ? 'sr-only 3xl:not-sr-only' : ''">
                <span v-for="l in connectionLabels" :key="l" class="col-start-1 row-start-1" :class="l === connectionView.label ? '' : 'invisible'" :aria-hidden="l !== connectionView.label">{{ l }}</span>
              </span>
            </span>
          </div>

          <button
            type="button"
            class="ccm-btn-plain text-xs font-medium"
            :aria-label="ui.compact ? t('compact.exit') : t('compact.enter')"
            :title="ui.compact ? t('compact.exitTitle') : t('compact.enterTitle')"
            :aria-pressed="ui.compact"
            data-tour="compact"
            @click="ui.toggleCompact()"
          >
            <Maximize2 v-if="ui.compact" :size="16" aria-hidden="true" />
            <Minimize2 v-else :size="16" aria-hidden="true" />
            <span v-if="ui.compact" class="hidden sm:inline">{{ t('compact.exit') }}</span>
          </button>
          <button
            type="button"
            class="ccm-btn-plain text-xs font-medium"
            data-tour="palette"
            :aria-label="t('palette.open')"
            :title="t('palette.open')"
            aria-keyshortcuts="Control+K"
            @click="ui.paletteOpen = true"
          >
            <Search :size="16" aria-hidden="true" />
            <kbd class="hidden rounded-[4px] bg-fill px-1 font-mono text-2xs text-ink-faint 2xl:inline">Ctrl K</kbd>
          </button>
          <button
            type="button"
            class="ccm-btn-plain hidden text-xs font-medium 2xl:inline-flex"
            :aria-label="t('settings.language') + ': ' + t('settings.switchLanguage')"
            @click="settings.toggleLocale()"
          >
            <Languages :size="16" aria-hidden="true" />
            <span>{{ settings.locale === 'en' ? 'VI' : 'EN' }}</span>
          </button>
          <button
            type="button"
            class="ccm-btn-plain hidden 2xl:inline-flex"
            :aria-label="settings.theme === 'dark' ? t('settings.toLight') : t('settings.toDark')"
            :title="settings.theme === 'dark' ? t('settings.toLight') : t('settings.toDark')"
            @click="toggleTheme"
          >
            <Transition
              mode="out-in"
              enter-active-class="transition duration-(--ccm-dur-base) ease-spring"
              enter-from-class="opacity-0 rotate-[-60deg] scale-75"
              leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
              leave-to-class="opacity-0 rotate-[60deg] scale-75"
            >
              <Sun v-if="settings.theme === 'dark'" key="sun" :size="16" aria-hidden="true" />
              <Moon v-else key="moon" :size="16" aria-hidden="true" />
            </Transition>
          </button>
          <SettingsMenu />
        </div>
      </div>
    </div>
    <!-- Overlays the content edge instead of growing the header, so the page does not jump on every reconnect. -->
    <Transition name="ccm-fade">
      <div
        v-if="connection.state !== 'connected' && connection.hasData"
        role="status"
        class="ccm-material absolute inset-x-0 top-full border-b border-line text-center text-xs text-warning"
      >
        <p class="bg-warning-soft px-4 py-1.5 sm:px-6">{{ t('connection.stale') }}</p>
      </div>
    </Transition>
  </header>
</template>
