<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_QUIET, TOAST_KINDS, isHm, type QuietHours, type TerminalApp, type ToastKind } from '@ccm/shared'
import { Bell, BellOff, Check, ChevronRight, CircleAlert, CircleCheck, Copy, FileText, FolderX, GraduationCap, ListChecks, Minus, Plus, Send, Settings2, Stethoscope, X } from 'lucide-vue-next'
import { BREAK_MINUTES, breakAnchor, nextBreakAt } from '../lib/breaks'
import { now } from '../lib/format'
import { retireOverlay } from '../lib/motion'
import { isMac } from '../lib/platform'
import { forgetGrants, fullAccess, hasGrants } from '../lib/preview'
import { playChime } from '../lib/sound'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useTipsStore } from '../stores/tips'
import { useUiStore } from '../stores/ui'
import { desktop, hasRun, hasTerminals } from '../lib/desktop'
import { CODE_SIZE_MAX, CODE_SIZE_MIN } from '../lib/fonts'
import { stepCodeSize, zoomApp, zoomHud } from '../composables/useWheelZoom'
import { STUCK_CHOICES, useSettingsStore } from '../stores/settings'
import LottieArt from './LottieArt.vue'
import RunSdkSettings from './RunSdkSettings.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import SegmentedControl from './ui/SegmentedControl.vue'
import ThemePicker from './ui/ThemePicker.vue'
import FontPicker from './ui/FontPicker.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const extras = useExtrasStore()
const connection = useConnectionStore()
const ui = useUiStore()
const tips = useTipsStore()
const tipsOn = computed({ get: () => !tips.state.off, set: (on: boolean) => tips.setOff(!on) })
const panel = ref<HTMLElement | null>(null)
const grantsForgotten = ref(false)

async function onForgetGrants(): Promise<void> {
  grantsForgotten.value = await forgetGrants()
  if (grantsForgotten.value) setTimeout(() => (grantsForgotten.value = false), 4000)
}
const fullAccessOn = ref<boolean | null>(null)
async function setFullAccess(on: boolean): Promise<void> {
  const now = await fullAccess(on)
  fullAccessOn.value = typeof now === 'boolean' ? now : null
}
const loginItem = ref<boolean | null>(null)
async function setLoginItem(on: boolean): Promise<void> {
  loginItem.value = on
  const now = await desktop?.loginItem?.(on)
  loginItem.value = typeof now === 'boolean' ? now : null
}
// App zoom lives in the main process (Chromium level); read once per open, then follow the HUD.
const appZoom = ref<number | null>(null)
watch(zoomHud, (h) => {
  if (h?.kind === 'app') appZoom.value = h.value
})
const steppers = computed(() => [
  {
    id: 'codesize',
    label: t('fonts.size'),
    hint: t(isMac ? 'fonts.sizeHintMac' : 'fonts.sizeHint'),
    value: t('fonts.px', { n: settings.codeFontSize }),
    canDown: settings.codeFontSize > CODE_SIZE_MIN,
    canUp: settings.codeFontSize < CODE_SIZE_MAX,
    step: (d: -1 | 0 | 1) => stepCodeSize(settings, d),
  },
  ...(desktop?.zoomApp && appZoom.value !== null
    ? [
        {
          id: 'appzoom',
          label: t('fonts.zoom'),
          hint: t(isMac ? 'fonts.zoomHintMac' : 'fonts.zoomHint'),
          value: `${appZoom.value}%`,
          // Chromium levels -3…+3 ≈ 58%…173%.
          canDown: appZoom.value > 58,
          canUp: appZoom.value < 173,
          step: (d: -1 | 0 | 1) => void zoomApp(d === 0 ? 'reset' : d > 0 ? 'in' : 'out'),
        },
      ]
    : []),
])
const openFontLicenses = (): void => void window.open('/fonts-LICENSES.txt', '_blank')
const helpItems = computed<{ key: string; icon: Component; label: string; hint: string; run: () => void }[]>(() => [
  { key: 'tour', icon: GraduationCap, label: t('tour.open'), hint: t('settings.tourHint'), run: () => (ui.tourOpen = 'monitor') },
  ...(hasTerminals ? [{ key: 'wsTour', icon: GraduationCap, label: t('wsHelp.tour'), hint: t('wsTour.welcome.title'), run: () => (ui.tourOpen = 'workspace') }] : []),
  { key: 'diag', icon: Stethoscope, label: t('diag.open'), hint: t('settings.diagHint'), run: () => (ui.diagnosticsOpen = true) },
  ...(desktop ? [{ key: 'setup', icon: ListChecks, label: t('setup.open'), hint: t('setup.openHint'), run: () => (ui.setupOpen = true) }] : []),
  { key: 'fonts', icon: FileText, label: t('fonts.licenses'), hint: t('fonts.licensesHint'), run: openFontLicenses },
])
const closeButton = ref<HTMLButtonElement | null>(null)
let restoreFocus: HTMLElement | null = null

const locales = [
  { value: 'vi' as const, label: 'Tiếng Việt', lang: 'vi' },
  { value: 'en' as const, label: 'English', lang: 'en' },
]
const terminalApps = computed(() => (['terminal', 'iterm'] as TerminalApp[]).map((app) => ({ value: app, label: t(`settings.launchTerminalApp.${app}`) })))
const stuckOptions = computed(() => STUCK_CHOICES.map((m) => ({ value: m as number, label: m ? t('settings.minutes', { n: m }) : t('settings.off') })))

const events = computed(() => [
  { key: 'notifyWaiting', label: t('settings.notifyWaiting') },
  { key: 'notifyDone', label: t('settings.notifyDone') },
  { key: 'notifyStuck', label: t('settings.notifyStuck') },
  { key: 'notifyLoop', label: t('settings.notifyLoop') },
  { key: 'notifyContext', label: t('settings.notifyContext') },
  { key: 'notifyLimit', label: t('settings.notifyLimit') },
] as const)

const sound = computed({
  get: () => settings.sound,
  set: (on: boolean) => {
    settings.sound = on
    // The click is the user gesture that unlocks audio; the preview confirms the volume.
    if (on) playChime('waiting')
  },
})
const notify = computed({
  get: () => settings.notifyEnabled,
  set: () => void settings.toggleNotifications(),
})

const snippet = computed(() =>
  extras.statusLineCommand ? JSON.stringify({ statusLine: { type: 'command', command: extras.statusLineCommand } }, null, 2) : '',
)
const copied = ref(false)
async function copySnippet(): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.value)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}

const breakHint = computed(() => {
  const anchor = breakAnchor(extras.dayStartedAt, now.value)
  if (anchor === null) return t('settings.breakHint', { n: BREAK_MINUTES })
  const fmt = new Intl.DateTimeFormat(settings.locale, { hour: '2-digit', minute: '2-digit', hour12: false })
  return t('settings.breakHintAt', { n: BREAK_MINUTES, since: fmt.format(anchor), next: fmt.format(nextBreakAt(anchor, now.value)) })
})

const blocked = computed(() => settings.notifyPermission === 'denied')
const unsupported = computed(() => settings.notifyPermission === 'unsupported')
const bellLabel = computed(() => (settings.notifyEnabled ? t('settings.notifyOff') : t('settings.notifyOn')))
const offline = computed(() => connection.state !== 'connected')
const toast = computed({
  get: () => extras.toast === 'on',
  set: (on: boolean) => void connection.updateNotify({ toast: on }),
})
const toastAvailable = computed(() => extras.toast === 'on' || extras.toast === 'off')
const quiet = computed(() => extras.notify?.quiet ?? DEFAULT_QUIET)

function setKind(kind: ToastKind, on: boolean): void {
  connection.updateNotify({ kinds: { [kind]: on } })
}

function setQuiet(patch: Partial<QuietHours>): void {
  connection.updateNotify({ quiet: { ...quiet.value, ...patch } })
}

function setStuck(minutes: number): void {
  settings.stuckMinutes = minutes
  connection.updateNotify({ stuckMinutes: minutes })
}

const testNote = computed(() => {
  const r = extras.toastTest
  if (!r) return null
  if (r.state === 'sending') return { tone: 'muted', text: t('settings.toastTest.sending') }
  if (r.result !== 'ok') return { tone: 'error', text: t(`settings.toastTest.${r.result}`) }
  return { tone: 'ok', text: t('settings.toastTest.ok') }
})
const healthNote = computed(() => {
  const h = extras.toastTest?.state === 'done' ? (extras.toastTest.health ?? extras.notify?.health) : extras.notify?.health
  return h === 'globalOff' || h === 'appOff' ? t(`settings.toastHealth.${h}`) : null
})

onBeforeUnmount(() => extras.setToastTest(null))

function onTime(field: 'from' | 'to', e: Event): void {
  const input = e.target as HTMLInputElement
  if (isHm(input.value)) setQuiet({ [field]: input.value })
  else input.value = quiet.value[field]
}

const notifyNote = computed(() => (unsupported.value ? t('settings.notifyUnsupported') : blocked.value ? t('settings.notifyBlocked') : t('settings.notifyHint')))

function close(): void {
  ui.settingsOpen = false
}

function openFrom(action: () => void): void {
  close()
  void nextTick(action)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')]
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

watch(
  () => ui.settingsOpen,
  async (open) => {
    if (open) {
      void desktop?.zoomApp?.('get').then((pct) => (appZoom.value = typeof pct === 'number' ? pct : null))
      void desktop?.loginItem?.().then((on) => (loginItem.value = typeof on === 'boolean' ? on : null))
      void fullAccess().then((on) => (fullAccessOn.value = on))
      restoreFocus = document.activeElement as HTMLElement | null
      await nextTick()
      closeButton.value?.focus()
    } else {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
)

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
    class="ccm-btn-plain size-8"
    :aria-label="t('settings.title')"
    :title="t('settings.title')"
    :aria-expanded="ui.settingsOpen"
    aria-controls="settings-panel"
    @click="ui.settingsOpen = !ui.settingsOpen"
  >
    <Settings2 :size="18" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <Transition name="ccm-scrim">
      <div v-if="ui.settingsOpen" class="fixed inset-0 z-50 ccm-scrim" @mousedown.self="close" />
    </Transition>
    <Transition name="ccm-side" @before-leave="retireOverlay">
      <aside
        v-if="ui.settingsOpen"
        id="settings-panel"
        ref="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        class="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col bg-canvas shadow-pop"
        @keydown="onKey"
      >
        <header class="flex items-center gap-3 border-b border-line px-4 py-3">
          <div class="min-w-0 flex-1">
            <h2 id="settings-title" class="text-base font-semibold">{{ t('settings.title') }}</h2>
            <p class="truncate text-2xs text-ink-faint" :title="t('settings.subtitle')">{{ t('settings.subtitle') }}</p>
          </div>
          <button
            ref="closeButton"
            type="button"
            class="ccm-btn-plain"
            :aria-label="t('settings.close')"
            :title="t('settings.close')"
            @click="close"
          >
            <X :size="16" aria-hidden="true" />
          </button>
        </header>

        <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-8">
          <section aria-labelledby="set-appearance">
            <h3 id="set-appearance" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('settings.section.appearance') }}</h3>
            <div class="ccm-group">
              <div class="px-3 py-2">
                <p class="mb-2 text-sm">{{ t('settings.theme') }}</p>
                <ThemePicker />
              </div>
              <div class="flex items-center justify-between gap-3 px-3 py-2">
                <span class="min-w-0 text-sm">{{ t('settings.language') }}</span>
                <SegmentedControl v-model="settings.locale" :options="locales" :label="t('settings.language')" />
              </div>
              <ToggleSwitch v-model="settings.keyHints" :label="t('keys.hints')" :hint="t('keys.hintsHint')" class="px-3" />
              <ToggleSwitch v-if="hasTerminals" v-model="settings.minimap" :label="t('settings.minimap')" :hint="t('settings.minimapHint')" class="px-3" />
              <ToggleSwitch v-if="hasTerminals" v-model="settings.dimInactive" :label="t('workspace.dim.setting')" :hint="t('workspace.dim.settingHint')" class="px-3" />
              <ToggleSwitch v-if="hasTerminals" v-model="settings.dustEffect" :label="t('settings.dust')" :hint="t('settings.dustHint')" class="px-3" />
              <ToggleSwitch v-if="hasTerminals" v-model="tipsOn" :label="t('tips.setting')" :hint="t('tips.settingHint')" class="px-3" />
            </div>
          </section>

          <section aria-labelledby="set-text" class="mt-6">
            <h3 id="set-text" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('fonts.section') }}</h3>
            <div class="ccm-group">
              <FontPicker kind="code" />
              <div v-for="row in steppers" :key="row.id" class="flex items-center gap-3 px-3 py-2">
                <div class="min-w-0 flex-1">
                  <p :id="`set-${row.id}`" class="text-sm">{{ row.label }}</p>
                  <p class="mt-0.5 text-2xs text-ink-faint">{{ row.hint }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-0.5" role="group" :aria-labelledby="`set-${row.id}`" :data-stepper="row.id">
                  <button type="button" class="ccm-btn-plain size-7" :aria-label="t('fonts.smaller')" :title="t('fonts.smaller')" :disabled="!row.canDown" @click="row.step(-1)">
                    <Minus :size="14" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="ccm-btn-plain h-7 min-w-14 justify-center px-1.5 text-sm tabular"
                    :title="t('fonts.reset')"
                    :aria-label="`${row.value} · ${t('fonts.reset')}`"
                    @click="row.step(0)"
                  >
                    {{ row.value }}
                  </button>
                  <button type="button" class="ccm-btn-plain size-7" :aria-label="t('fonts.larger')" :title="t('fonts.larger')" :disabled="!row.canUp" @click="row.step(1)">
                    <Plus :size="14" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <FontPicker kind="ui" />
            </div>
          </section>

          <section v-if="loginItem !== null" aria-labelledby="set-startup" class="mt-6">
            <h3 id="set-startup" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('settings.section.startup') }}</h3>
            <div class="ccm-group">
              <ToggleSwitch
                :model-value="loginItem"
                :label="t(isMac ? 'settings.loginItemMac' : 'settings.loginItem')"
                :hint="t(isMac ? 'settings.loginItemHintMac' : 'settings.loginItemHint')"
                class="px-3"
                @update:model-value="setLoginItem"
              />
            </div>
          </section>

          <section v-if="isMac" aria-labelledby="set-launch" class="mt-6">
            <h3 id="set-launch" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('settings.section.launch') }}</h3>
            <div class="ccm-group">
              <div class="flex items-center justify-between gap-3 px-3 py-2">
                <div class="min-w-0 flex-1">
                  <p class="text-sm">{{ t('settings.launchTerminal') }}</p>
                  <p class="mt-0.5 text-2xs text-ink-faint">{{ t('settings.launchTerminalHint') }}</p>
                </div>
                <SegmentedControl v-model="ui.launchTerminal" :options="terminalApps" :label="t('settings.launchTerminal')" />
              </div>
            </div>
          </section>

          <section aria-labelledby="set-notify" class="mt-6">
            <h3 id="set-notify" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('settings.section.notifications') }}</h3>
            <template v-if="toastAvailable">
              <div class="ccm-group">
                <ToggleSwitch v-model="toast" :label="t('settings.toast')" :hint="isMac ? t('settings.toastHintMac') : t('settings.toastHint')" :disabled="offline" class="px-3" />
                <p v-if="healthNote" role="alert" class="flex items-start gap-2 bg-st-error/10 px-3 py-2 text-xs leading-relaxed text-ink">
                  <CircleAlert :size="14" class="mt-0.5 shrink-0 text-st-error" aria-hidden="true" />{{ healthNote }}
                </p>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <button
                    type="button"
                    class="ccm-btn"
                    :disabled="!toast || offline || extras.toastTest?.state === 'sending'"
                    @click="connection.testToast()"
                  >
                    <Send :size="13" aria-hidden="true" />{{ t('settings.toastTest.action') }}
                  </button>
                  <span
                    v-if="testNote"
                    aria-live="polite"
                    class="text-2xs"
                    :class="testNote.tone === 'error' ? 'text-st-error' : testNote.tone === 'ok' ? 'text-ink-muted' : 'text-ink-faint'"
                  >{{ testNote.text }}</span>
                </div>
              </div>
              <p class="mt-4 mb-1.5 px-3 text-2xs text-ink-faint" aria-hidden="true">{{ t('settings.toastKinds') }}</p>
              <div class="ccm-group" role="group" :aria-label="t('settings.toastKinds')">
                <ToggleSwitch
                  v-for="k in TOAST_KINDS"
                  :key="k"
                  :model-value="extras.notify?.kinds[k] ?? false"
                  :label="t(`settings.toastKind.${k}`)"
                  :disabled="!toast || offline"
                  class="px-3"
                  @update:model-value="(on: boolean) => setKind(k, on)"
                />
              </div>
            </template>
            <div class="ccm-group" :class="toastAvailable ? 'mt-4' : ''">
              <ToggleSwitch
                v-model="notify"
                :label="t('settings.notifyEnable')"
                :hint="toast && !unsupported && !blocked ? `${notifyNote} ${t('settings.toastOnHint')}` : notifyNote"
                :disabled="unsupported"
                class="px-3"
              />
            </div>
            <p class="mt-4 mb-1.5 px-3 text-2xs text-ink-faint" aria-hidden="true">{{ t('settings.notifyEvents') }}</p>
            <div class="ccm-group" :aria-label="t('settings.notifyEvents')" role="group">
              <ToggleSwitch
                v-for="ev in events"
                :key="ev.key"
                v-model="settings[ev.key]"
                :label="ev.label"
                :disabled="!settings.notifyEnabled"
                class="px-3"
              />
            </div>
            <div class="ccm-group mt-4">
              <ToggleSwitch v-model="sound" :label="t('settings.sound')" :hint="t('settings.soundHint')" class="px-3" />
              <ToggleSwitch
                v-if="extras.notify"
                :model-value="quiet.enabled"
                :label="t('settings.quiet')"
                :hint="t('settings.quietHint')"
                :disabled="offline"
                class="px-3"
                @update:model-value="(on: boolean) => setQuiet({ enabled: on })"
              />
              <div v-if="extras.notify" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
                <label v-for="f in (['from', 'to'] as const)" :key="f" class="flex items-center gap-2 text-xs text-ink-muted">
                  {{ f === 'from' ? t('settings.quietFrom') : t('settings.quietTo') }}
                  <input
                    type="time"
                    :value="quiet[f]"
                    :disabled="!quiet.enabled || offline"
                    class="ccm-field tabular disabled:cursor-not-allowed disabled:opacity-50"
                    @change="onTime(f, $event)"
                  />
                </label>
              </div>
            </div>
          </section>

          <section aria-labelledby="set-reminders" class="mt-6">
            <h3 id="set-reminders" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('settings.section.reminders') }}</h3>
            <div class="ccm-group">
              <ToggleSwitch v-model="settings.breakReminder" :label="t('settings.breakReminder')" :hint="breakHint" class="px-3" />
              <div class="px-3 py-2">
                <p class="text-sm">{{ t('settings.stuck') }}</p>
                <p class="mt-0.5 text-2xs text-ink-faint">{{ t('settings.stuckHint') }}</p>
                <SegmentedControl
                  :model-value="settings.stuckMinutes"
                  :options="stuckOptions"
                  :label="t('settings.stuck')"
                  fill
                  class="mt-2 w-full"
                  @update:model-value="setStuck"
                />
              </div>
              <div class="flex items-center gap-3 px-3 py-2">
                <div class="min-w-0 flex-1">
                  <label for="set-budget" class="block text-sm">{{ t('settings.budget') }}</label>
                  <p class="mt-0.5 text-2xs text-ink-faint">{{ t('settings.budgetHint') }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <div
                    class="ccm-field flex w-24 items-center gap-1"
                  >
                    <span class="text-ink-muted" aria-hidden="true">$</span>
                    <input
                      id="set-budget"
                      :value="settings.dailyBudget || ''"
                      type="number"
                      min="0"
                      step="1"
                      inputmode="decimal"
                      :placeholder="t('settings.off')"
                      class="ccm-bare-input h-full min-w-0 flex-1 bg-transparent tabular outline-none placeholder:text-ink-faint"
                      @change="settings.dailyBudget = Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)"
                    />
                  </div>
                  <span class="text-2xs text-ink-faint">{{ t('settings.perDay') }}</span>
                </div>
              </div>
            </div>
          </section>

          <section v-if="snippet" aria-labelledby="set-statusline" class="mt-6">
            <div class="mb-1.5 flex items-center justify-between gap-3 px-3">
              <h3 id="set-statusline" class="text-2xs font-semibold text-ink-muted">{{ t('limits.setupTitle') }}</h3>
              <span class="inline-flex items-center gap-1 text-2xs font-medium" :class="extras.limits ? 'text-success' : 'text-warning'">
                <CircleCheck v-if="extras.limits" :size="13" aria-hidden="true" /><CircleAlert v-else :size="13" aria-hidden="true" />
                {{ extras.limits ? t('settings.bridgeOn') : t('settings.bridgeOff') }}
              </span>
            </div>
            <div class="ccm-group">
              <div class="px-3 py-2">
                <p class="mb-2 text-2xs leading-relaxed text-ink-faint">{{ extras.limits ? t('limits.setupActive') : t('limits.setupHint') }}</p>
                <div class="relative">
                  <pre class="max-h-36 overflow-auto rounded-inner bg-fill p-3 pr-11 font-mono text-2xs whitespace-pre-wrap break-all text-ink-muted">{{ snippet }}</pre>
                  <button
                    type="button"
                    class="ccm-btn-plain absolute top-1.5 right-1.5"
                    :aria-label="copied ? t('limits.copied') : t('limits.copy')"
                    :title="copied ? t('limits.copied') : t('limits.copy')"
                    @click="copySnippet"
                  >
                    <Check v-if="copied" :size="14" class="ccm-pop text-success" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />
                  </button>
                </div>
                <p class="mt-2 text-2xs leading-relaxed text-ink-faint">{{ t('limits.chainHint') }}</p>
              </div>
            </div>
          </section>

          <RunSdkSettings v-if="hasRun && ui.settingsOpen" :open="ui.settingsOpen" />

          <section v-if="hasGrants" aria-labelledby="set-access" class="mt-6">
            <h3 id="set-access" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('settings.section.access') }}</h3>
            <div class="ccm-group overflow-hidden">
              <ToggleSwitch
                v-if="fullAccessOn !== null"
                :model-value="fullAccessOn"
                :label="t('settings.fullAccess')"
                :hint="t('settings.fullAccessHint')"
                class="px-3"
                data-full-access
                @update:model-value="setFullAccess"
              />
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-fill disabled:cursor-default"
                :disabled="grantsForgotten"
                data-forget-grants
                @click="onForgetGrants"
              >
                <component :is="grantsForgotten ? CircleCheck : FolderX" :size="16" class="shrink-0" :class="grantsForgotten ? 'text-success' : 'text-ink-muted'" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm">{{ grantsForgotten ? t('settings.forgetGrantsDone') : t('settings.forgetGrants') }}</span>
                  <span class="mt-0.5 block text-2xs text-ink-faint">{{ t('settings.forgetGrantsHint') }}</span>
                </span>
              </button>
            </div>
          </section>

          <section aria-labelledby="set-help" class="mt-6">
            <h3 id="set-help" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('settings.section.help') }}</h3>
            <div class="ccm-group overflow-hidden">
              <button
                v-for="h in helpItems"
                :key="h.key"
                type="button"
                class="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-fill"
                @click="openFrom(h.run)"
              >
                <component :is="h.icon" :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm">{{ h.label }}</span>
                  <span class="mt-0.5 block text-2xs text-ink-faint">{{ h.hint }}</span>
                </span>
                <ChevronRight :size="14" class="shrink-0 text-ink-faint" aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
