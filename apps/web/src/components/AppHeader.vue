<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, ChartColumnBig, Ellipsis, History, Maximize2, Minimize2, Puzzle, Search, Smartphone, SquareTerminal } from 'lucide-vue-next'
import { hasExtensions, hasTerminals, titleBar } from '../lib/desktop'
import { hasDevices } from '../lib/devices'
import { now, relativeTime } from '../lib/format'
import type { MenuEntry, Rect } from '../lib/menu'
import { isMac } from '../lib/platform'
import { formatKeys } from '../lib/shortcuts'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useUiStore, type View } from '../stores/ui'
import PlanLimits from './PlanLimits.vue'
import SettingsMenu from './SettingsMenu.vue'
import ContextMenu from './ui/ContextMenu.vue'

const { t, locale } = useI18n()
const connection = useConnectionStore()
const extras = useExtrasStore()
const ui = useUiStore()

const primary = computed(() => [
  { id: 'monitor' as View, label: t('nav.monitor'), icon: Activity },
  ...(hasTerminals ? [{ id: 'workspace' as View, label: t('nav.workspace'), icon: SquareTerminal }] : []),
])
const secondary = computed(() => [
  { id: 'usage' as View, label: t('nav.usage'), icon: ChartColumnBig },
  { id: 'history' as View, label: t('nav.history'), icon: History },
  ...(hasExtensions ? [{ id: 'extensions' as View, label: t('nav.extensions'), icon: Puzzle }] : []),
  ...(hasDevices ? [{ id: 'devices' as View, label: t('nav.devices'), icon: Smartphone }] : []),
])
const tabs = computed(() => {
  const extra = secondary.value.find((x) => x.id === ui.view)
  return extra ? [...primary.value, extra] : primary.value
})
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

const lastUpdate = computed(() => {
  const ago = relativeTime(connection.lastEventAt, locale.value, now.value)
  return ago ? t('connection.lastUpdate', { ago }) : t('connection.never')
})
const connectionTitle = computed(() =>
  connection.state !== 'connected' && connection.hasData ? t('connection.stale') : `${connectionView.value.label}. ${lastUpdate.value}`,
)

const showClaudeLimits = computed(() => !!(extras.limits?.fiveHour || extras.limits?.sevenDay))
const showCodexLimits = computed(() => !!(extras.codexLimits?.fiveHour || extras.codexLimits?.sevenDay))

const barClass = computed(() => (titleBar === 'mac' ? 'pl-[84px]' : 'pl-3'))
const barStyle = computed(() => (titleBar === 'overlay' ? { paddingRight: 'max(0.5rem, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 0.5rem))' } : { paddingRight: '0.5rem' }))

const moreBtn = ref<HTMLButtonElement | null>(null)
const moreAt = ref<Rect | null>(null)
let moreClosedAt = 0
const moreEntries = computed<MenuEntry[]>(() => secondary.value.map((v) => ({ id: v.id, label: v.label, icon: v.icon })))
function closeMore(): void {
  moreAt.value = null
  moreClosedAt = performance.now()
}
function toggleMore(): void {
  if (moreAt.value) return closeMore()
  if (performance.now() - moreClosedAt < 250) return
  const r = moreBtn.value?.getBoundingClientRect()
  if (r) moreAt.value = { left: r.left, right: r.right, top: r.top, bottom: r.bottom + 4 }
}
function pickMore(id: string): void {
  ui.setView(id as View)
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
  <header class="ccm-material ccm-titlebar sticky top-0 z-30 border-b border-line" :data-title-bar="titleBar ?? undefined">
    <div class="flex h-10 min-w-0 items-center gap-2" :class="barClass" :style="barStyle">
      <ArtImage name="logo" class="size-5 shrink-0" :aria-label="t('app.title')" role="img" />

      <div
        v-if="!ui.compact"
        data-tour="tabs"
        role="tablist"
        :aria-label="t('nav.label')"
        class="relative grid shrink-0 auto-cols-fr grid-flow-col rounded-control bg-fill p-0.5"
      >
        <span
          v-if="activeIndex >= 0"
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
          class="relative inline-flex h-6 cursor-pointer items-center justify-center gap-1.5 rounded-inner px-2.5 text-xs font-medium transition-colors sm:min-w-[92px]"
          :class="ui.view === tab.id ? 'text-ink' : 'text-ink-muted hover:text-ink'"
          @click="ui.setView(tab.id)"
          @keydown="onTabKey"
        >
          <component :is="tab.icon" :size="14" aria-hidden="true" />
          <span class="hidden sm:inline">{{ tab.label }}</span>
        </button>
      </div>

      <button
        v-if="!ui.compact && secondary.length"
        ref="moreBtn"
        type="button"
        class="ccm-btn-plain size-7 justify-center p-0"
        data-tour="more-views"
        :aria-label="t('nav.more')"
        :title="t('nav.more')"
        aria-haspopup="menu"
        :aria-expanded="!!moreAt"
        @click="toggleMore"
      >
        <Ellipsis :size="16" aria-hidden="true" />
      </button>

      <div class="h-full min-w-4 flex-1" aria-hidden="true" />

      <div v-if="showClaudeLimits || showCodexLimits" data-tour="limits" class="hidden min-w-0 items-center gap-0.5 sm:flex">
        <PlanLimits v-if="showClaudeLimits" compact />
        <PlanLimits v-if="showCodexLimits" provider="codex" compact />
      </div>

      <span
        class="inline-flex size-7 shrink-0 items-center justify-center"
        :class="connectionView.cls"
        role="status"
        aria-live="polite"
        :aria-label="connectionView.label"
        :title="connectionTitle"
      >
        <span v-if="connectionView.glyph === 'live'" class="relative flex size-2">
          <span class="absolute inset-0 rounded-full bg-current opacity-0 motion-safe:animate-ping motion-safe:[animation-iteration-count:3]" />
          <span class="relative size-2 rounded-full bg-current" />
        </span>
        <svg v-else width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path v-if="connectionView.glyph === 'half'" d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
        </svg>
      </span>

      <div class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="ccm-btn-plain text-xs font-medium"
          :aria-label="ui.compact ? t('compact.exit') : t('compact.enter')"
          :title="ui.compact ? t('compact.exitTitle') : t('compact.enterTitle')"
          :aria-pressed="ui.compact"
          data-tour="compact"
          @click="ui.toggleCompact()"
        >
          <Maximize2 v-if="ui.compact" :size="15" aria-hidden="true" />
          <Minimize2 v-else :size="15" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="ccm-btn-plain text-xs font-medium"
          data-tour="palette"
          :aria-label="t('palette.open')"
          :title="`${t('palette.open')} (${formatKeys(['Mod', 'K'], isMac).join(isMac ? '' : '+')})`"
          :aria-keyshortcuts="isMac ? 'Meta+K' : 'Control+K'"
          @click="ui.paletteOpen = true"
        >
          <Search :size="15" aria-hidden="true" />
        </button>
        <SettingsMenu />
      </div>
    </div>
    <ContextMenu v-if="moreAt" :at="moreAt" :entries="moreEntries" :label="t('nav.more')" :trigger="moreBtn" @pick="pickMore" @close="closeMore" />
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
