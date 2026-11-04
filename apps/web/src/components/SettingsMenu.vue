<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bell, BellOff, Bot, ChevronRight, Database, GitBranch, Info, MoveDiagonal2, Palette, Plug, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, SquareTerminal, Timer, X } from 'lucide-vue-next'
import { clampDialogSize, readDialogSize, saveDialogSize, type DialogSize } from '../lib/dialogSize'
import { retireOverlay } from '../lib/motion'
import { isMac } from '../lib/platform'
import { hasAgentData } from '../lib/agentData'
import { hasBackup } from '../lib/backup'
import { hasAwake, hasCapture } from '../lib/capture'
import { hasDisk } from '../lib/buildClean'
import { desktop, hasDeepSeek, hasRun, hasTerminals } from '../lib/desktop'
import { hasGitHub } from '../lib/github'
import { hasPhone } from '../lib/phone'
import { hasTelegram } from '../lib/telegram'
import { hasGrants } from '../lib/preview'
import { hasUpdater } from '../lib/update'
import { useExtrasStore } from '../stores/extras'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useUpdateStore } from '../stores/update'
import LottieArt from './LottieArt.vue'
import GitHubAccountsSettings from './GitHubAccountsSettings.vue'
import TelegramSettings from './TelegramSettings.vue'
import SettingsAbout from './settings/SettingsAbout.vue'
import SettingsAccess from './settings/SettingsAccess.vue'
import SettingsAppearance from './settings/SettingsAppearance.vue'
import SettingsData from './settings/SettingsData.vue'
import SettingsDeepSeek from './settings/SettingsDeepSeek.vue'
import SettingsEditor from './settings/SettingsEditor.vue'
import SettingsGeneral from './settings/SettingsGeneral.vue'
import SettingsIntegrations from './settings/SettingsIntegrations.vue'
import SettingsNotify from './settings/SettingsNotify.vue'
import SettingsReminders from './settings/SettingsReminders.vue'
import SettingEmbed from './settings/SettingEmbed.vue'
import { SETTINGS_PAGES, entries, isSettingsPage, loadPage, pageVisible, savePage, searchSettings, type SettingsEnv, type SettingsPage } from './settings'

const { t } = useI18n()
const settings = useSettingsStore()
const extras = useExtrasStore()
const ui = useUiStore()
const update = useUpdateStore()

const panel = ref<HTMLElement | null>(null)

const SIZE_KEY = 'ccm.settings.size'
const DEFAULT_SIZE: DialogSize = { w: 1040, h: 760 }
const MIN_SIZE: DialogSize = { w: 560, h: 420 }
const EDGE = 16
const size = ref<DialogSize | null>(readDialogSize(SIZE_KEY))
const resizing = ref(false)
const panelStyle = computed(() => {
  const s = size.value ?? DEFAULT_SIZE
  return { width: `min(${s.w}px, calc(100vw - ${2 * EDGE}px))`, height: `min(${s.h}px, calc(100dvh - ${2 * EDGE}px))` }
})
const view = (): DialogSize => ({ w: window.innerWidth, h: window.innerHeight })

let endResize: (() => void) | null = null

function startResize(e: PointerEvent): void {
  if (!panel.value) return
  endResize?.()
  const handle = e.currentTarget as HTMLElement
  handle.focus({ preventScroll: true })
  handle.setPointerCapture(e.pointerId)
  const rect = panel.value.getBoundingClientRect()
  const start = { x: e.clientX, y: e.clientY }
  resizing.value = true
  const move = (ev: PointerEvent) => (size.value = clampDialogSize(rect.width + 2 * (ev.clientX - start.x), rect.height + 2 * (ev.clientY - start.y), MIN_SIZE, view(), EDGE))
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', up)
    handle.removeEventListener('lostpointercapture', up)
    endResize = null
    resizing.value = false
    saveDialogSize(SIZE_KEY, size.value)
  }
  endResize = up
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', up)
  handle.addEventListener('lostpointercapture', up)
}

watch(
  () => ui.settingsOpen,
  (open) => {
    if (!open) endResize?.()
  },
)
onBeforeUnmount(() => endResize?.())

function nudgeSize(dw: number, dh: number): void {
  if (!panel.value) return
  const rect = panel.value.getBoundingClientRect()
  size.value = clampDialogSize(rect.width + dw, rect.height + dh, MIN_SIZE, view(), EDGE)
  saveDialogSize(SIZE_KEY, size.value)
}

function resetSize(): void {
  size.value = null
  saveDialogSize(SIZE_KEY, null)
}
const content = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const page = ref<SettingsPage>('general')
const query = ref('')
let restoreFocus: HTMLElement | null = null
let flashTimer: number | undefined

const pageIcons: Record<SettingsPage, Component> = {
  general: SlidersHorizontal,
  appearance: Palette,
  editor: SquareTerminal,
  notify: Bell,
  telegram: Send,
  reminders: Timer,
  github: GitBranch,
  integrations: Plug,
  deepseek: Bot,
  access: ShieldCheck,
  data: Database,
  about: Info,
}

const env = computed<SettingsEnv>(() => ({
  terminals: hasTerminals,
  mac: isMac,
  loginItem: Boolean(desktop?.loginItem),
  zoom: Boolean(desktop?.zoomApp),
  awake: hasAwake,
  github: hasGitHub,
  run: hasRun,
  capture: hasCapture,
  agentData: hasAgentData,
  phone: hasPhone,
  telegram: hasTelegram,
  disk: hasDisk,
  updater: hasUpdater,
  backup: hasBackup,
  grants: hasGrants,
  statusLine: Boolean(extras.statusLineCommand),
  toast: extras.toast === 'on' || extras.toast === 'off',
  notifyData: Boolean(extras.notify),
  deepseek: hasDeepSeek,
}))
const pages = computed(() => SETTINGS_PAGES.filter((p) => pageVisible(p, env.value)))
const allEntries = computed(() => entries(isMac))
const hits = computed(() => searchSettings(query.value, allEntries.value, env.value, (k) => t(k)))
const searching = computed(() => query.value.trim() !== '')
const pageLabel = (p: SettingsPage): string => t(`settingsV79.pages.${p}`)

const bellLabel = computed(() => (settings.notifyEnabled ? t('settings.notifyOff') : t('settings.notifyOn')))
const blocked = computed(() => settings.notifyPermission === 'denied')
const unsupported = computed(() => settings.notifyPermission === 'unsupported')

function close(): void {
  ui.settingsOpen = false
}

function show(next: SettingsPage): void {
  page.value = pageVisible(next, env.value) ? next : 'general'
  savePage(page.value)
  query.value = ''
  if (content.value) content.value.scrollTop = 0
}

async function flash(id: string): Promise<void> {
  await nextTick()
  if (id === 'disk' || id === 'phone') {
    content.value?.querySelector<HTMLElement>('[data-notify-more][aria-expanded="false"]')?.click()
    await nextTick()
  }
  const row = content.value?.querySelector<HTMLElement>(`[data-setting-row="${id}"]`)
  if (!row) return
  row.scrollIntoView({ block: 'center' })
  row.classList.add('ccm-setting-flash')
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => row.classList.remove('ccm-setting-flash'), 1400)
}

function openHit(hit: { page: SettingsPage; id: string }): void {
  show(hit.page)
  void flash(hit.id)
}

function takeRequestedPage(): void {
  const wanted = ui.settingsPage
  if (!wanted) return
  ui.settingsPage = null
  if (isSettingsPage(wanted)) show(wanted)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (searching.value && document.activeElement === searchInput.value) query.value = ''
    else close()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter(
    (el) => el.tabIndex >= 0 && el.offsetParent !== null,
  )
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

function onGlobalKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.altKey || e.shiftKey || e.code !== 'Comma' || !(isMac ? e.metaKey : e.ctrlKey)) return
  e.preventDefault()
  ui.settingsOpen = !ui.settingsOpen
}
onMounted(() => document.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKey)
  window.clearTimeout(flashTimer)
})

watch(
  () => ui.settingsOpen,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      query.value = ''
      page.value = pageVisible(loadPage(), env.value) ? loadPage() : 'general'
      takeRequestedPage()
      await nextTick()
      panel.value?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
    } else {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
)
watch(() => ui.settingsPage, () => ui.settingsOpen && takeRequestedPage())

const ringing = ref(0)
let ringTimer: number | undefined
watch(
  () => settings.notifyEnabled,
  (on) => {
    window.clearTimeout(ringTimer)
    if (!on) return void (ringing.value = 0)
    ringing.value++
    ringTimer = window.setTimeout(() => (ringing.value = 0), 900)
  },
)
onBeforeUnmount(() => window.clearTimeout(ringTimer))
</script>

<template>
  <button
    type="button"
    class="ccm-btn-plain relative size-8"
    :aria-label="bellLabel"
    :aria-pressed="settings.notifyEnabled"
    :title="blocked ? t('settings.notifyBlocked') : bellLabel"
    :disabled="unsupported"
    @click="settings.toggleNotifications()"
  >
    <LottieArt v-if="ringing" name="notification-bell" :play-key="ringing" class="size-6 text-accent-ink" />
    <Bell v-else-if="settings.notifyEnabled" :size="18" class="text-accent-ink" aria-hidden="true" />
    <BellOff v-else :size="18" aria-hidden="true" />
  </button>

  <button
    type="button"
    data-tour="settings"
    class="ccm-btn-plain relative size-8"
    :aria-label="update.available ? `${t('settings.title')} · ${t('update.availableShort', { version: update.state?.release?.version ?? '' })}` : t('settings.title')"
    :title="t('settings.title')"
    :aria-expanded="ui.settingsOpen"
    aria-controls="settings-panel"
    @click="ui.settingsOpen = !ui.settingsOpen"
  >
    <Settings2 :size="18" aria-hidden="true" />
    <span v-if="update.available" class="absolute top-1 right-1 size-2 rounded-full bg-accent ring-2 ring-canvas" aria-hidden="true" data-update-dot />
  </button>

  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="ui.settingsOpen" class="fixed inset-0 z-50 flex items-center justify-center ccm-scrim p-4" @mousedown.self="close">
        <div
          id="settings-panel"
          ref="panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          class="ccm-sheet relative flex flex-col overflow-hidden bg-canvas"
          :class="resizing ? '' : 'transition-[width,height] duration-(--ccm-dur-base) ease-out-quint'"
          :style="panelStyle"
          data-settings-dialog
          @keydown="onKey"
        >
          <h2 id="settings-title" class="sr-only">{{ t('settings.title') }}</h2>
          <div class="@container flex min-h-0 flex-1 flex-col">
          <div class="flex min-h-0 flex-1 flex-col @[720px]:flex-row">
            <div class="flex shrink-0 flex-col gap-2 border-b border-line bg-fill p-3 @[720px]:w-56 @[720px]:border-r @[720px]:border-b-0">
              <label class="relative block">
                <span class="sr-only">{{ t('settingsV79.searchLabel') }}</span>
                <Search :size="14" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                <input
                  ref="searchInput"
                  v-model="query"
                  type="search"
                  autocomplete="off"
                  spellcheck="false"
                  class="ccm-field w-full pr-2 pl-8"
                  :placeholder="t('settingsV79.searchPlaceholder')"
                  data-settings-search
                  @keydown.enter.prevent="hits[0] && openHit(hits[0])"
                />
              </label>
              <nav
                :aria-label="t('settingsV79.nav')"
                class="ccm-scroll flex min-h-0 flex-wrap gap-1 @[720px]:flex-1 @[720px]:flex-col @[720px]:flex-nowrap @[720px]:overflow-y-auto"
              >
                <button
                  v-for="p in pages"
                  :key="p"
                  type="button"
                  class="flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm transition-colors @[720px]:w-full"
                  :class="p === page && !searching ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-muted hover:bg-fill-strong hover:text-ink'"
                  :aria-current="p === page && !searching ? 'page' : undefined"
                  :data-settings-page="p"
                  @click="show(p)"
                >
                  <component :is="pageIcons[p]" :size="15" class="shrink-0" aria-hidden="true" />
                  <span class="min-w-0 truncate">{{ pageLabel(p) }}</span>
                </button>
              </nav>
              <p class="hidden px-1 text-2xs text-ink-faint @[720px]:block">{{ t('settings.subtitle') }}</p>
            </div>

            <div class="flex min-h-0 min-w-0 flex-1 flex-col">
              <header class="flex shrink-0 items-center gap-3 border-b border-line py-2.5 pr-3 pl-5">
                <h3 class="min-w-0 flex-1 truncate text-base font-semibold">{{ searching ? t('settingsV79.results') : pageLabel(page) }}</h3>
                <button type="button" class="ccm-btn-plain" :aria-label="t('settings.close')" :title="t('settings.close')" @click="close">
                  <X :size="16" aria-hidden="true" />
                </button>
              </header>

              <div ref="content" class="ccm-scroll ccm-set-page min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-4 pb-6 sm:mb-5" :data-settings-current="searching ? 'search' : page">
                <template v-if="searching">
                  <ul v-if="hits.length" class="ccm-group overflow-hidden" data-settings-results>
                    <li v-for="h in hits" :key="`${h.page}:${h.id}`">
                      <button
                        type="button"
                        class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-fill"
                        :data-settings-hit="`${h.page}:${h.id}`"
                        @click="openHit(h)"
                      >
                        <span class="shrink-0 text-ink-muted">{{ pageLabel(h.page) }}</span>
                        <ChevronRight :size="13" class="shrink-0 text-ink-faint" aria-hidden="true" />
                        <span class="min-w-0 flex-1 truncate">{{ h.label }}</span>
                      </button>
                    </li>
                  </ul>
                  <p v-else class="px-3 py-6 text-center text-sm text-ink-muted" role="status">{{ t('settingsV79.noResults', { q: query.trim() }) }}</p>
                </template>
                <template v-else>
                  <SettingsGeneral v-if="page === 'general'" />
                  <SettingsAppearance v-else-if="page === 'appearance'" />
                  <SettingsEditor v-else-if="page === 'editor'" />
                  <SettingsNotify v-else-if="page === 'notify'" />
                  <SettingEmbed v-else-if="page === 'telegram'" id="telegram"><TelegramSettings :open="ui.settingsOpen" /></SettingEmbed>
                  <SettingsReminders v-else-if="page === 'reminders'" />
                  <SettingEmbed v-else-if="page === 'github'" id="github"><GitHubAccountsSettings :open="ui.settingsOpen" /></SettingEmbed>
                  <SettingsIntegrations v-else-if="page === 'integrations'" />
                  <SettingsDeepSeek v-else-if="page === 'deepseek'" />
                  <SettingsAccess v-else-if="page === 'access'" />
                  <SettingsData v-else-if="page === 'data'" />
                  <SettingsAbout v-else-if="page === 'about'" />
                </template>
              </div>
            </div>
          </div>
          </div>
          <span
            role="button"
            tabindex="0"
            :aria-label="t('settingsV79.resize')"
            :title="t('settingsV79.resize')"
            class="absolute right-0.5 bottom-0.5 hidden size-5cursor-nwse-resize touch-none items-center justify-center rounded-md text-ink-faint outline-none hover:text-accent-ink focus-visible:text-accent-ink focus-visible:ring-2 focus-visible:ring-focus sm:inline-flex"
            data-settings-resize
            @pointerdown.prevent="startResize"
            @dblclick="resetSize"
            @keydown.left.prevent="nudgeSize(-32, 0)"
            @keydown.right.prevent="nudgeSize(32, 0)"
            @keydown.up.prevent="nudgeSize(0, -32)"
            @keydown.down.prevent="nudgeSize(0, 32)"
          >
            <MoveDiagonal2 :size="14" class="rotate-90" aria-hidden="true" />
          </span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.ccm-set-page [data-setting-row] {
  transition: background-color var(--ccm-dur-slow) ease-out;
}
.ccm-set-page .ccm-setting-flash {
  background-color: var(--ccm-accent-soft);
}
</style>
