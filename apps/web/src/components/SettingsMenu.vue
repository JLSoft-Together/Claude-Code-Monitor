<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_QUIET, TOAST_KINDS, isHm, type QuietHours, type ToastKind } from '@ccm/shared'
import { Bell, BellOff, Check, ChevronRight, CircleAlert, CircleCheck, Copy, GraduationCap, Moon, Send, Settings2, Stethoscope, Sun, X } from 'lucide-vue-next'
import { BREAK_MINUTES, breakAnchor, nextBreakAt } from '../lib/breaks'
import { now } from '../lib/format'
import { playChime } from '../lib/sound'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useUiStore } from '../stores/ui'
import { STUCK_CHOICES, useSettingsStore, type Palette } from '../stores/settings'
import LottieArt from './LottieArt.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const extras = useExtrasStore()
const connection = useConnectionStore()
const ui = useUiStore()
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let restoreFocus: HTMLElement | null = null

const palettes = computed<{ id: Palette; label: string; swatch: string[] }[]>(() => [
  { id: 'ember', label: t('settings.paletteEmber'), swatch: ['ember-1', 'ember-2', 'ember-3'] },
  { id: 'cobalt', label: t('settings.paletteCobalt'), swatch: ['cobalt-1', 'cobalt-2', 'cobalt-3'] },
])
const themes = computed(() => [
  { id: 'light' as const, label: t('settings.themeLight'), icon: Sun },
  { id: 'dark' as const, label: t('settings.themeDark'), icon: Moon },
])
const locales = [
  { id: 'vi' as const, label: 'Tiếng Việt' },
  { id: 'en' as const, label: 'English' },
]
const stuckOptions = computed(() => STUCK_CHOICES.map((m) => ({ value: m, label: m ? t('settings.minutes', { n: m }) : t('settings.off') })))

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
    class="relative inline-flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised"
    :class="settings.notifyEnabled ? 'text-accent' : 'text-ink-muted hover:text-ink'"
    :aria-label="bellLabel"
    :aria-pressed="settings.notifyEnabled"
    :title="blocked ? t('settings.notifyBlocked') : bellLabel"
    :disabled="unsupported"
    @click="settings.toggleNotifications()"
  >
    <LottieArt v-if="ringing" name="notification-bell" :play-key="ringing" class="size-6" />
    <Bell v-else-if="settings.notifyEnabled" :size="18" aria-hidden="true" />
    <BellOff v-else :size="18" aria-hidden="true" />
  </button>

  <button
    type="button"
    data-tour="settings"
    class="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
    :aria-label="t('settings.title')"
    :title="t('settings.title')"
    :aria-expanded="ui.settingsOpen"
    aria-controls="settings-panel"
    @click="ui.settingsOpen = !ui.settingsOpen"
  >
    <Settings2 :size="18" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div v-if="ui.settingsOpen" class="fixed inset-0 z-50 bg-ink/30" @mousedown.self="close" />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-250 ease-out-quint motion-reduce:transition-none"
      enter-from-class="translate-x-full"
      leave-active-class="transition-transform duration-150 ease-in motion-reduce:transition-none"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="ui.settingsOpen"
        id="settings-panel"
        ref="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        class="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-lg"
        @keydown="onKey"
      >
        <header class="flex items-center gap-3 border-b border-line px-5 py-4">
          <div class="min-w-0 flex-1">
            <h2 id="settings-title" class="text-base font-semibold">{{ t('settings.title') }}</h2>
            <p class="text-xs text-ink-faint">{{ t('settings.subtitle') }}</p>
          </div>
          <button
            ref="closeButton"
            type="button"
            class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            :aria-label="t('settings.close')"
            :title="t('settings.close')"
            @click="close"
          >
            <X :size="18" aria-hidden="true" />
          </button>
        </header>

        <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8">
          <section aria-labelledby="set-appearance" class="pt-5">
            <h3 id="set-appearance" class="mb-3 text-xs font-semibold text-ink-muted">{{ t('settings.section.appearance') }}</h3>
            <div class="flex flex-col gap-3">
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm">{{ t('settings.theme') }}</span>
                <div class="grid grid-cols-2 rounded-lg border border-line bg-canvas p-0.5" role="radiogroup" :aria-label="t('settings.theme')">
                  <button
                    v-for="th in themes"
                    :key="th.id"
                    type="button"
                    role="radio"
                    :aria-checked="settings.theme === th.id"
                    class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors"
                    :class="settings.theme === th.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'"
                    @click="settings.theme = th.id"
                  >
                    <component :is="th.icon" :size="14" aria-hidden="true" />{{ th.label }}
                  </button>
                </div>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm">{{ t('settings.language') }}</span>
                <div class="grid grid-cols-2 rounded-lg border border-line bg-canvas p-0.5" role="radiogroup" :aria-label="t('settings.language')">
                  <button
                    v-for="l in locales"
                    :key="l.id"
                    type="button"
                    role="radio"
                    :aria-checked="settings.locale === l.id"
                    :lang="l.id"
                    class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-xs font-medium transition-colors"
                    :class="settings.locale === l.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'"
                    @click="settings.locale = l.id"
                  >
                    {{ l.label }}
                  </button>
                </div>
              </div>
              <div>
                <span class="mb-2 block text-sm">{{ t('settings.palette') }}</span>
                <div class="grid grid-cols-2 gap-2" role="radiogroup" :aria-label="t('settings.palette')">
                  <button
                    v-for="p in palettes"
                    :key="p.id"
                    type="button"
                    role="radio"
                    :aria-checked="settings.palette === p.id"
                    class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors"
                    :class="settings.palette === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'"
                    @click="settings.palette = p.id"
                  >
                    <span class="flex -space-x-1" aria-hidden="true">
                      <span v-for="c in p.swatch" :key="c" class="size-4 rounded-full border border-surface" :style="{ background: `var(--ccm-swatch-${c})` }" />
                    </span>
                    <span class="min-w-0 flex-1 truncate">{{ p.label }}</span>
                    <Check v-if="settings.palette === p.id" :size="15" class="text-accent" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <ToggleSwitch v-model="settings.keyHints" :label="t('keys.hints')" :hint="t('keys.hintsHint')" />
            </div>
          </section>

          <section aria-labelledby="set-notify" class="mt-6 border-t border-line pt-5">
            <h3 id="set-notify" class="mb-1 text-xs font-semibold text-ink-muted">{{ t('settings.section.notifications') }}</h3>
            <template v-if="toastAvailable">
              <ToggleSwitch v-model="toast" :label="t('settings.toast')" :hint="t('settings.toastHint')" :disabled="offline" />
              <p v-if="healthNote" role="alert" class="mb-2 flex items-start gap-2 rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2 text-xs leading-relaxed text-ink">
                <CircleAlert :size="14" class="mt-0.5 shrink-0 text-st-error" aria-hidden="true" />{{ healthNote }}
              </p>
              <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!toast || offline || extras.toastTest?.state === 'sending'"
                  @click="connection.testToast()"
                >
                  <Send :size="13" aria-hidden="true" />{{ t('settings.toastTest.action') }}
                </button>
                <span
                  v-if="testNote"
                  aria-live="polite"
                  class="text-xs"
                  :class="testNote.tone === 'error' ? 'text-st-error' : testNote.tone === 'ok' ? 'text-ink-muted' : 'text-ink-faint'"
                >{{ testNote.text }}</span>
              </div>
              <div class="mt-1 mb-2 rounded-lg border border-line bg-canvas px-3 py-1" role="group" :aria-label="t('settings.toastKinds')">
                <p class="pt-2 text-xs text-ink-faint">{{ t('settings.toastKinds') }}</p>
                <ToggleSwitch
                  v-for="k in TOAST_KINDS"
                  :key="k"
                  :model-value="extras.notify?.kinds[k] ?? false"
                  :label="t(`settings.toastKind.${k}`)"
                  :disabled="!toast || offline"
                  class="border-b border-line last:border-b-0"
                  @update:model-value="(on: boolean) => setKind(k, on)"
                />
              </div>
            </template>
            <ToggleSwitch
              v-model="notify"
              :label="t('settings.notifyEnable')"
              :hint="toast && !unsupported && !blocked ? `${notifyNote} ${t('settings.toastOnHint')}` : notifyNote"
              :disabled="unsupported"
            />
            <div class="mt-1 rounded-lg border border-line bg-canvas px-3 py-1" :aria-label="t('settings.notifyEvents')" role="group">
              <p class="pt-2 text-xs text-ink-faint">{{ t('settings.notifyEvents') }}</p>
              <ToggleSwitch
                v-for="ev in events"
                :key="ev.key"
                v-model="settings[ev.key]"
                :label="ev.label"
                :disabled="!settings.notifyEnabled"
                class="border-b border-line last:border-b-0"
              />
            </div>
            <ToggleSwitch v-model="sound" :label="t('settings.sound')" :hint="t('settings.soundHint')" class="mt-2" />
            <div v-if="extras.notify" class="mt-2">
              <ToggleSwitch
                :model-value="quiet.enabled"
                :label="t('settings.quiet')"
                :hint="t('settings.quietHint')"
                :disabled="offline"
                @update:model-value="(on: boolean) => setQuiet({ enabled: on })"
              />
              <div class="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1">
                <label v-for="f in (['from', 'to'] as const)" :key="f" class="flex items-center gap-2 text-sm text-ink-muted">
                  {{ f === 'from' ? t('settings.quietFrom') : t('settings.quietTo') }}
                  <input
                    type="time"
                    :value="quiet[f]"
                    :disabled="!quiet.enabled || offline"
                    class="h-9 rounded-lg border border-line bg-canvas px-2 text-sm text-ink tabular outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                    @change="onTime(f, $event)"
                  />
                </label>
              </div>
            </div>
          </section>

          <section aria-labelledby="set-reminders" class="mt-6 border-t border-line pt-5">
            <h3 id="set-reminders" class="mb-1 text-xs font-semibold text-ink-muted">{{ t('settings.section.reminders') }}</h3>
            <ToggleSwitch v-model="settings.breakReminder" :label="t('settings.breakReminder')" :hint="breakHint" class="mb-3" />
            <p class="text-sm">{{ t('settings.stuck') }}</p>
            <p class="mt-0.5 mb-2 text-xs leading-relaxed text-ink-faint">{{ t('settings.stuckHint') }}</p>
            <div class="grid grid-cols-5 rounded-lg border border-line bg-canvas p-0.5" role="radiogroup" :aria-label="t('settings.stuck')">
              <button
                v-for="o in stuckOptions"
                :key="o.value"
                type="button"
                role="radio"
                :aria-checked="settings.stuckMinutes === o.value"
                class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md text-xs transition-colors"
                :class="settings.stuckMinutes === o.value ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-ink-muted hover:text-ink'"
                @click="setStuck(o.value)"
              >
                {{ o.label }}
              </button>
            </div>

            <label for="set-budget" class="mt-5 block text-sm">{{ t('settings.budget') }}</label>
            <p class="mt-0.5 mb-2 text-xs leading-relaxed text-ink-faint">{{ t('settings.budgetHint') }}</p>
            <div class="flex items-center gap-2">
              <div class="flex h-9 items-center rounded-lg border border-line bg-canvas focus-within:border-accent">
                <span class="pl-3 text-sm text-ink-muted" aria-hidden="true">$</span>
                <input
                  id="set-budget"
                  :value="settings.dailyBudget || ''"
                  type="number"
                  min="0"
                  step="1"
                  inputmode="decimal"
                  :placeholder="t('settings.off')"
                  class="h-full w-24 bg-transparent px-1.5 text-sm tabular outline-none"
                  @change="settings.dailyBudget = Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)"
                />
              </div>
              <span class="text-xs text-ink-faint">{{ t('settings.perDay') }}</span>
            </div>
          </section>

          <section v-if="snippet" aria-labelledby="set-statusline" class="mt-6 border-t border-line pt-5">
            <div class="mb-1 flex items-center justify-between gap-3">
              <h3 id="set-statusline" class="text-xs font-semibold text-ink-muted">{{ t('limits.setupTitle') }}</h3>
              <span class="inline-flex items-center gap-1 text-xs font-medium" :class="extras.limits ? 'text-st-done' : 'text-st-waiting'">
                <CircleCheck v-if="extras.limits" :size="14" aria-hidden="true" /><CircleAlert v-else :size="14" aria-hidden="true" />
                {{ extras.limits ? t('settings.bridgeOn') : t('settings.bridgeOff') }}
              </span>
            </div>
            <p class="mb-2 text-xs leading-relaxed text-ink-faint">{{ extras.limits ? t('limits.setupActive') : t('limits.setupHint') }}</p>
            <div class="relative">
              <pre class="max-h-36 overflow-auto rounded-lg border border-line bg-canvas p-3 pr-12 font-mono text-2xs whitespace-pre-wrap break-all text-ink-muted">{{ snippet }}</pre>
              <button
                type="button"
                class="absolute top-2 right-2 inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-line bg-surface text-ink-muted transition-colors hover:border-accent hover:text-accent"
                :aria-label="copied ? t('limits.copied') : t('limits.copy')"
                :title="copied ? t('limits.copied') : t('limits.copy')"
                @click="copySnippet"
              >
                <Check v-if="copied" :size="14" class="ccm-pop text-st-done" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />
              </button>
            </div>
            <p class="mt-2 text-2xs leading-relaxed text-ink-faint">{{ t('limits.chainHint') }}</p>
          </section>

          <section aria-labelledby="set-help" class="mt-6 border-t border-line pt-5">
            <h3 id="set-help" class="mb-2 text-xs font-semibold text-ink-muted">{{ t('settings.section.help') }}</h3>
            <div class="overflow-hidden rounded-lg border border-line">
              <button
                v-for="h in [
                  { key: 'tour', icon: GraduationCap, label: t('tour.open'), hint: t('settings.tourHint'), run: () => (ui.tourOpen = true) },
                  { key: 'diag', icon: Stethoscope, label: t('diag.open'), hint: t('settings.diagHint'), run: () => (ui.diagnosticsOpen = true) },
                ]"
                :key="h.key"
                type="button"
                class="flex w-full cursor-pointer items-center gap-3 border-b border-line px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-raised"
                @click="openFrom(h.run)"
              >
                <component :is="h.icon" :size="17" class="shrink-0 text-ink-muted" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm">{{ h.label }}</span>
                  <span class="block text-xs text-ink-faint">{{ h.hint }}</span>
                </span>
                <ChevronRight :size="16" class="shrink-0 text-ink-faint" aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
