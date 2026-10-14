<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bell, CircleAlert, CircleCheck, FolderOpen, Gauge, LoaderCircle, MessageSquareMore, Volume2, X } from 'lucide-vue-next'
import { desktop, type StatusLineState } from '../lib/desktop'
import { retireOverlay } from '../lib/motion'
import { playChime } from '../lib/sound'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

type ItemId = 'notify' | 'toast' | 'sound' | 'statusLine' | 'folder'

const DONE_KEY = 'ccm.setupDone'
const { t } = useI18n()
const ui = useUiStore()
const settings = useSettingsStore()
const extras = useExtrasStore()
const connection = useConnectionStore()
const dialog = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const statusLine = ref<StatusLineState | null>(null)
const statusLineNote = ref<'failed' | null>(null)
const busy = ref<ItemId | null>(null)
const folder = ref<string | null>(null)
/** Rows of this showing: on the first run only what was off when it opened (turned-on rows stay, marked On). */
const shown = ref<ItemId[]>([])
const ready = ref(false)

function done(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return true
  }
}

function markDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1')
  } catch {
    // The sheet may then show again next launch; harmless.
  }
}

const available = (id: ItemId): boolean => {
  if (id === 'notify') return settings.notifyPermission !== 'unsupported'
  if (id === 'toast') return extras.toast === 'on' || extras.toast === 'off'
  if (id === 'statusLine') return !!desktop?.enableStatusLine && statusLine.value !== null
  if (id === 'folder') return !!desktop?.grantFolder
  return true
}

const isOn = (id: ItemId): boolean => {
  if (id === 'notify') return settings.notifyEnabled
  if (id === 'toast') return extras.toast === 'on'
  if (id === 'sound') return settings.sound
  if (id === 'statusLine') return statusLine.value === 'ours'
  return folder.value !== null
}

const ORDER: ItemId[] = ['notify', 'toast', 'sound', 'statusLine', 'folder']
const ICONS = { notify: Bell, toast: MessageSquareMore, sound: Volume2, statusLine: Gauge, folder: FolderOpen } as const

const rows = computed(() =>
  shown.value.map((id) => {
    const on = isOn(id)
    let note: string | null = null
    let blocked = false
    if (id === 'notify' && settings.notifyPermission === 'denied') {
      note = t('setup.notify.blocked')
      blocked = true
    } else if (id === 'statusLine' && statusLine.value === 'unreadable') {
      note = t('setup.statusLine.unreadable')
      blocked = true
    } else if (id === 'statusLine' && statusLineNote.value) note = t(`setup.statusLine.${statusLineNote.value}`)
    else if (id === 'statusLine' && on) note = t('setup.statusLine.newSessions')
    else if (id === 'folder' && folder.value) note = t('setup.folder.granted', { path: folder.value })
    return { id, icon: ICONS[id], title: t(`setup.${id}.title`), body: t(`setup.${id}.body`), on, note, blocked }
  }),
)

async function enable(id: ItemId): Promise<void> {
  if (busy.value) return
  busy.value = id
  try {
    if (id === 'notify') await settings.toggleNotifications()
    else if (id === 'toast') connection.updateNotify({ toast: true })
    else if (id === 'sound') {
      settings.sound = true
      // The click unlocks audio; the preview confirms the volume.
      playChime('waiting')
    } else if (id === 'statusLine') {
      statusLineNote.value = null
      const res = await desktop?.enableStatusLine?.()
      if (res === 'ok' || res === 'ours') statusLine.value = 'ours'
      else if (res === 'unreadable') statusLine.value = 'unreadable'
      else if (res === 'failed') statusLineNote.value = 'failed'
    } else if (id === 'folder') {
      const picked = await desktop?.grantFolder?.()
      if (picked) folder.value = picked
    }
  } finally {
    busy.value = null
  }
}

function close(): void {
  markDone()
  ui.setupOpen = false
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

/** Waits for the first snapshot (toast state lives in it) and the status line check, then picks the rows. */
async function prepare(firstRun: boolean): Promise<void> {
  ready.value = false
  if (connection.state !== 'connected')
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => (stop(), resolve()), 8_000)
      const stop = watch(
        () => connection.state,
        (s) => s === 'connected' && (window.clearTimeout(timer), stop(), resolve()),
      )
    })
  statusLine.value = (await desktop?.statusLineState?.().catch(() => null)) ?? null
  shown.value = ORDER.filter((id) => available(id) && (!firstRun || !isOn(id)))
  if (!shown.value.length) {
    // Everything is on already: nothing to ask on a first run.
    if (firstRun) close()
    return
  }
  ready.value = true
  restoreFocus = document.activeElement as HTMLElement | null
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('[data-setup-action]:not([disabled]), button')?.focus()
}

// First launch (after install or update to v27): opens on its own, once. Guides wait while setupOpen is set.
let firstRun = !!desktop && !done()
if (firstRun) ui.setupOpen = true

watch(
  () => ui.setupOpen,
  (open) => {
    if (open) {
      void prepare(firstRun)
      firstRun = false
    } else {
      ready.value = false
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => (ready.value = false))
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="ui.setupOpen && ready" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto ccm-scrim px-4 py-[8vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-title"
          aria-describedby="setup-subtitle"
          class="w-full max-w-[520px] ccm-sheet"
          data-quick-setup
          @keydown="trap"
        >
          <div class="flex items-start gap-2 border-b border-line px-5 py-4">
            <div class="mr-auto min-w-0">
              <h2 id="setup-title" class="text-base font-semibold">{{ t('setup.title') }}</h2>
              <p id="setup-subtitle" class="mt-0.5 text-xs text-ink-muted">{{ t('setup.subtitle') }}</p>
            </div>
            <button type="button" class="ccm-btn-plain -mr-1" :aria-label="t('setup.later')" :title="t('setup.later')" @click="close">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <ul class="divide-y divide-line px-5">
            <li v-for="r in rows" :key="r.id" class="flex gap-3 py-3.5" :data-setup-row="r.id">
              <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-inner bg-fill" aria-hidden="true">
                <component :is="r.icon" :size="16" :class="r.on ? 'text-success' : 'text-ink-muted'" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">{{ r.title }}</p>
                <p class="mt-0.5 text-xs leading-relaxed text-ink-muted">{{ r.body }}</p>
                <p
                  v-if="r.note"
                  class="mt-1 flex items-start gap-1 text-2xs leading-relaxed break-all"
                  :class="r.blocked || (r.id === 'statusLine' && !r.on) ? 'text-warning' : 'text-ink-faint'"
                  :role="r.blocked ? 'alert' : undefined"
                >
                  <CircleAlert v-if="r.blocked" :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />{{ r.note }}
                </p>
              </div>
              <div class="flex shrink-0 items-start pt-0.5">
                <span v-if="r.on && r.id !== 'folder'" class="inline-flex h-7 items-center gap-1 text-xs font-medium text-success" :data-setup-on="r.id">
                  <CircleCheck :size="14" aria-hidden="true" />{{ t('setup.on') }}
                </span>
                <button
                  v-else
                  type="button"
                  class="ccm-btn"
                  :class="r.on ? '' : 'ccm-btn-primary'"
                  :disabled="r.blocked || busy !== null"
                  :aria-busy="busy === r.id || undefined"
                  :aria-label="`${r.id === 'folder' ? t('setup.choose') : t('setup.turnOn')}: ${r.title}`"
                  :data-setup-action="r.id"
                  @click="enable(r.id)"
                >
                  <LoaderCircle v-if="busy === r.id" :size="13" class="animate-spin" aria-hidden="true" />
                  {{ r.id === 'folder' ? t('setup.choose') : t('setup.turnOn') }}
                </button>
              </div>
            </li>
          </ul>

          <div class="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" class="ccm-btn" @click="close">{{ t('setup.later') }}</button>
            <button type="button" class="ccm-btn ccm-btn-primary" data-setup-done @click="close">{{ t('setup.done') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
