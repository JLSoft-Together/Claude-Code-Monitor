<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, ChartColumnBig, CircleArrowDown, Ellipsis, GraduationCap, History, Inbox, Keyboard, Maximize2, Minimize2, Puzzle, Search, Smartphone, SquareTerminal, SunDim } from 'lucide-vue-next'
import { leaves } from '../lib/splitLayout'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import { hasExtensions, hasTerminals, titleBar } from '../lib/desktop'
import { hasDevices } from '../lib/devices'
import { hasTelegram } from '../lib/telegram'
import type { MenuEntry, Rect } from '../lib/menu'
import { isMac } from '../lib/platform'
import { formatKeys } from '../lib/shortcuts'
import { useConnectionStore } from '../stores/connection'
import { useInboxStore } from '../stores/inbox'
import { useUpdateStore } from '../stores/update'
import { useUiStore, type View } from '../stores/ui'
import HeaderStatusPopover from './HeaderStatusPopover.vue'
import TelegramToggle from './TelegramToggle.vue'
import SettingsMenu from './SettingsMenu.vue'
import ContextMenu from './ui/ContextMenu.vue'

const InboxPanel = defineAsyncComponent(() => import('./inbox/InboxPanel.vue'))

const { t } = useI18n()
const connection = useConnectionStore()
const ui = useUiStore()
const settings = useSettingsStore()
const workspace = useWorkspaceStore()
const inbox = useInboxStore()
const update = useUpdateStore()
const updateVersion = computed(() => update.state?.release?.version ?? '')
const inboxBtn = ref<HTMLButtonElement | null>(null)
const inboxAt = ref<DOMRect | null>(null)
const inboxCount = computed(() => inbox.items.length)
watch(
  () => inbox.open,
  (o) => (inboxAt.value = o ? (inboxBtn.value?.getBoundingClientRect() ?? null) : null),
)

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

const barClass = computed(() => (titleBar === 'mac' ? 'pl-[84px]' : 'pl-3'))
const barStyle = computed(() => (titleBar === 'overlay' ? { paddingRight: 'max(0.5rem, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 0.5rem))' } : { paddingRight: '0.5rem' }))

const moreBtn = ref<HTMLButtonElement | null>(null)
const moreAt = ref<Rect | null>(null)
let moreClosedAt = 0
const COMPACT_ID = 'compact'
const DIM_ID = 'dim'
const KEYS_ID = 'shortcuts'
const TOUR_ID = 'tour'
const splitTab = computed(() => ui.view === 'workspace' && !!workspace.activeTab && leaves(workspace.activeTab.root).length > 1)
const moreEntries = computed<MenuEntry[]>(() => {
  const views: MenuEntry[] = ui.compact ? [] : secondary.value.map((v) => ({ id: v.id, label: v.label, icon: v.icon }))
  const toggle: MenuEntry = { id: COMPACT_ID, label: ui.compact ? t('compact.exit') : t('compact.enter'), icon: ui.compact ? Maximize2 : Minimize2, hint: ui.compact ? t('compact.exitTitle') : t('compact.enterTitle') }
  const dim: MenuEntry[] = splitTab.value ? [{ id: DIM_ID, label: t(settings.dimInactive ? 'workspace.dim.toggleOn' : 'workspace.dim.toggle'), icon: SunDim, hint: t('workspace.dim.hint') }] : []
  const help: MenuEntry[] = [
    { id: KEYS_ID, label: t('wsHelp.shortcuts'), icon: Keyboard },
    ...(ui.view === 'workspace' ? [{ id: TOUR_ID, label: t('wsHelp.tour'), icon: GraduationCap }] : []),
  ]
  return [...views, ...(views.length ? [{ separator: true as const }] : []), ...dim, toggle, { separator: true }, ...help]
})
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
  if (id === COMPACT_ID) return ui.toggleCompact()
  if (id === DIM_ID) return void (settings.dimInactive = !settings.dimInactive)
  if (id === KEYS_ID) return void (ui.shortcutsOpen = true)
  if (id === TOUR_ID) return void (ui.tourOpen = 'workspace')
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
        ref="moreBtn"
        type="button"
        class="ccm-btn-plain size-7 justify-center p-0"
        data-tour="compact"
        data-more-views
        :aria-label="t('nav.more')"
        :title="t('nav.more')"
        aria-haspopup="menu"
        :aria-expanded="!!moreAt"
        @click="toggleMore"
      >
        <Ellipsis :size="16" aria-hidden="true" />
      </button>

      <div class="h-full min-w-4 flex-1" aria-hidden="true" />

      <div class="flex shrink-0 items-center gap-0.5">
        <button
          v-if="update.available && !ui.compact"
          type="button"
          class="ccm-btn-plain mr-1 h-6 gap-1 rounded-full bg-fill px-2 text-xs font-medium text-accent-ink"
          :title="t('update.pillTitle', { version: updateVersion })"
          :aria-label="t('update.pillTitle', { version: updateVersion })"
          aria-haspopup="dialog"
          data-update-pill
          @click="update.dialogOpen = true"
        >
          <CircleArrowDown :size="14" aria-hidden="true" />
          <span class="hidden tabular-nums sm:inline">{{ t('update.pill', { version: updateVersion }) }}</span>
        </button>
        <TelegramToggle v-if="hasTelegram" />
        <HeaderStatusPopover />
        <button
          ref="inboxBtn"
          type="button"
          class="ccm-btn-plain relative text-xs font-medium"
          :aria-label="t('inbox.button', { n: inboxCount }, inboxCount)"
          :title="t('inbox.button', { n: inboxCount }, inboxCount)"
          aria-haspopup="dialog"
          :aria-expanded="inbox.open"
          data-inbox-button
          @click="inbox.open = !inbox.open"
        >
          <Inbox :size="15" aria-hidden="true" />
          <span
            v-if="inboxCount"
            class="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-st-waiting px-0.5 text-[11px] leading-none font-semibold text-on-accent tabular-nums"
            aria-hidden="true"
            data-inbox-badge
            >{{ inboxCount > 99 ? '99+' : inboxCount }}</span
          >
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
    <InboxPanel v-if="inbox.open && inboxAt" :anchor="inboxAt" :trigger="inboxBtn" @close="inbox.open = false" />
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
