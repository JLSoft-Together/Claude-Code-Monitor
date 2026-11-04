<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, Send } from 'lucide-vue-next'
import { DEFAULT_IDLE_MINUTES, DEFAULT_QUIET, IDLE_CHOICES, isHm, type QuietHours, type ToastKind } from '@ccm/shared'
import { hasDisk } from '../../lib/buildClean'
import { hasPhone } from '../../lib/phone'
import { hasTelegram } from '../../lib/telegram'
import { isMac } from '../../lib/platform'
import { playChime } from '../../lib/sound'
import { useConnectionStore } from '../../stores/connection'
import { useExtrasStore } from '../../stores/extras'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import DiskSettings from '../DiskSettings.vue'
import PhoneSettings from '../PhoneSettings.vue'
import TelegramSettings from '../TelegramSettings.vue'
import ToggleSwitch from '../ToggleSwitch.vue'
import InfoHint from './InfoHint.vue'
import SettingEmbed from './SettingEmbed.vue'
import SettingRow from './SettingRow.vue'
import SettingSection from './SettingSection.vue'
import { NOTIFY_ROWS } from './index'

const { t } = useI18n()
const settings = useSettingsStore()
const extras = useExtrasStore()
const connection = useConnectionStore()
const ui = useUiStore()

const offline = computed(() => connection.state !== 'connected')
const blocked = computed(() => settings.notifyPermission === 'denied')
const unsupported = computed(() => settings.notifyPermission === 'unsupported')
const toastAvailable = computed(() => extras.toast === 'on' || extras.toast === 'off')
const toast = computed({
  get: () => extras.toast === 'on',
  set: (on: boolean) => void connection.updateNotify({ toast: on }),
})
const notify = computed({
  get: () => settings.notifyEnabled,
  set: () => void settings.toggleNotifications(),
})
const sound = computed({
  get: () => settings.sound,
  set: (on: boolean) => {
    settings.sound = on
    // The click is the user gesture that unlocks audio; the preview confirms the volume.
    if (on) playChime('waiting')
  },
})

const moreOpen = ref(false)
const rows = computed(() => NOTIFY_ROWS.filter((r) => toastAvailable.value || r.inApp))
const toastDisabled = computed(() => !toast.value || offline.value)
const notifyDisabled = computed(() => !settings.notifyEnabled)
const cols = computed(() => (toastAvailable.value ? 'grid-cols-[minmax(0,1fr)_5.5rem_5.5rem]' : 'grid-cols-[minmax(0,1fr)_5.5rem]'))

function setKind(kind: ToastKind, on: boolean): void {
  connection.updateNotify({ kinds: { [kind]: on } })
}

const quiet = computed(() => extras.notify?.quiet ?? DEFAULT_QUIET)
function setQuiet(patch: Partial<QuietHours>): void {
  connection.updateNotify({ quiet: { ...quiet.value, ...patch } })
}
function onTime(field: 'from' | 'to', e: Event): void {
  const input = e.target as HTMLInputElement
  if (isHm(input.value)) setQuiet({ [field]: input.value })
  else input.value = quiet.value[field]
}

const idleOptions = computed(() =>
  IDLE_CHOICES.map((m) => ({ value: m as number, label: !m ? t('settings.off') : m % 60 ? t('settings.minutes', { n: m }) : t('resources.hours', { n: m / 60 }) })),
)
const idleMinutes = computed(() => extras.notify?.idleMinutes ?? DEFAULT_IDLE_MINUTES)

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
const notifyNote = computed(() => (unsupported.value ? t('settings.notifyUnsupported') : blocked.value ? t('settings.notifyBlocked') : null))
const notifyInfo = computed(() => `${t('settings.notifyHint')}${toast.value ? ` ${t('settings.toastOnHint')}` : ''}`)

onBeforeUnmount(() => extras.setToastTest(null))
</script>

<template>
  <div>
    <SettingSection id="channels" :title="t('settingsV79.channels')">
      <template v-if="toastAvailable">
        <ToggleSwitch
          v-model="toast"
          :label="t('settings.toast')"
          :info="isMac ? t('settings.toastHintMac') : t('settings.toastHint')"
          :disabled="offline"
          class="px-3"
          data-setting-row="toast"
        />
        <p v-if="healthNote" role="alert" class="flex items-start gap-2 bg-st-error/10 px-3 py-2 text-xs leading-relaxed text-ink">
          <CircleAlert :size="14" class="mt-0.5 shrink-0 text-st-error" aria-hidden="true" />{{ healthNote }}
        </p>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-setting-row="testToast">
          <button type="button" class="ccm-btn" :disabled="!toast || offline || extras.toastTest?.state === 'sending'" @click="connection.testToast()">
            <Send :size="13" aria-hidden="true" />{{ t('settings.toastTest.action') }}
          </button>
          <span
            v-if="testNote"
            aria-live="polite"
            class="text-2xs"
            :class="testNote.tone === 'error' ? 'text-st-error' : testNote.tone === 'ok' ? 'text-ink-muted' : 'text-ink-faint'"
          >{{ testNote.text }}</span>
        </div>
      </template>
      <ToggleSwitch
        v-model="notify"
        :label="t('settings.notifyEnable')"
        :info="notifyInfo"
        :hint="notifyNote ?? undefined"
        :disabled="unsupported"
        class="px-3"
        data-setting-row="notifyEnable"
      />
    </SettingSection>

    <SettingSection id="events" :title="t('settingsV79.eventsTitle')">
      <div role="table" :aria-label="t('settingsV79.eventsTitle')" data-notify-table>
        <div role="row" class="grid items-center gap-x-2 px-3 py-1.5 text-2xs font-medium text-ink-muted" :class="cols">
          <span role="columnheader">{{ t('settingsV79.colEvent') }}</span>
          <span v-if="toastAvailable" role="columnheader" class="text-center" :title="t('settingsV79.colToastHint')">{{ t('settingsV79.colToast') }}</span>
          <span role="columnheader" class="text-center" :title="t('settingsV79.colAppHint')">{{ t('settingsV79.colApp') }}</span>
        </div>
        <div
          v-for="r in rows"
          :key="r.kind"
          role="row"
          class="grid items-center gap-x-2 border-t-[0.5px] border-line px-3 py-1.5"
          :class="cols"
          :data-setting-row="`event-${r.kind}`"
        >
          <div role="cell" class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-sm" :title="t(`settingsV79.events.${r.kind}`)">{{ t(`settingsV79.events.${r.kind}`) }}</span>
            <InfoHint :text="t(`settings.toastKind.${r.kind}`)" :what="t(`settingsV79.events.${r.kind}`)" />
          </div>
          <div v-if="toastAvailable" role="cell" class="flex justify-center">
            <input
              type="checkbox"
              class="size-4 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
              :checked="extras.notify?.kinds[r.kind] ?? false"
              :disabled="toastDisabled"
              :aria-label="`${t(`settingsV79.events.${r.kind}`)}: ${t('settingsV79.colToast')}`"
              :data-notify-kind="r.kind"
              @change="setKind(r.kind, ($event.target as HTMLInputElement).checked)"
            />
          </div>
          <div role="cell" class="flex justify-center">
            <input
              v-if="r.inApp"
              v-model="settings[r.inApp]"
              type="checkbox"
              class="size-4 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="notifyDisabled"
              :aria-label="`${t(`settingsV79.events.${r.kind}`)}: ${t('settingsV79.colApp')}`"
              :data-notify-app="r.kind"
            />
            <span v-else class="text-ink-faint" :title="t('settingsV79.toastOnly')" aria-hidden="true">–</span>
          </div>
        </div>
      </div>
    </SettingSection>

    <SettingSection id="sound" :title="t('settingsV79.soundGroup')">
      <ToggleSwitch v-model="sound" :label="t('settings.sound')" :info="t('settings.soundHint')" class="px-3" data-setting-row="sound" />
      <template v-if="extras.notify">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" :class="offline ? 'opacity-50' : ''" data-setting-row="quiet">
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <p class="text-sm">{{ t('settings.quiet') }}</p>
            <InfoHint :text="t('settings.quietHint')" :what="t('settings.quiet')" />
          </div>
          <div class="flex items-center gap-1.5 text-ink-muted">
            <input
              v-for="f in (['from', 'to'] as const)"
              :key="f"
              type="time"
              :value="quiet[f]"
              :disabled="!quiet.enabled || offline"
              :aria-label="f === 'from' ? t('settings.quietFrom') : t('settings.quietTo')"
              :title="f === 'from' ? t('settings.quietFrom') : t('settings.quietTo')"
              class="ccm-field tabular disabled:cursor-not-allowed disabled:opacity-50"
              @change="onTime(f, $event)"
            />
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="quiet.enabled"
            :aria-label="t('settings.quiet')"
            :disabled="offline"
            class="group relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-(--ccm-dur-base) ease-out-quint disabled:cursor-not-allowed"
            :class="quiet.enabled ? 'bg-accent' : 'bg-fill-strong'"
            @click="setQuiet({ enabled: !quiet.enabled })"
          >
            <span
              class="inline-block size-[18px] rounded-full bg-on-accent shadow-control transition-transform duration-(--ccm-dur-base) ease-spring group-enabled:group-active:scale-x-[1.2]"
              :class="quiet.enabled ? 'origin-right translate-x-[18px]' : 'origin-left translate-x-[2px]'"
              aria-hidden="true"
            />
          </button>
        </div>
        <SettingRow :label="t('resources.idleSetting')" :info="t('resources.idleSettingHint')" data-setting-row="idle">
          <select
            :value="idleMinutes"
            :disabled="offline"
            :aria-label="t('resources.idleSetting')"
            class="ccm-field cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            data-idle-select
            @change="connection.updateNotify({ idleMinutes: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option v-for="o in idleOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </SettingRow>
      </template>
    </SettingSection>

    <SettingSection v-if="hasDisk || hasPhone" id="more">
      <div class="flex items-center gap-3 px-3 py-2" data-notify-more-row>
        <div class="min-w-0 flex-1">
          <p class="text-sm">{{ t('settingsV79.moreAlerts') }}</p>
          <p class="mt-0.5 text-2xs text-ink-faint">{{ t('settingsV79.moreAlertsHint') }}</p>
        </div>
        <button type="button" class="ccm-btn" :aria-expanded="moreOpen" aria-controls="notify-more" data-notify-more @click="moreOpen = !moreOpen">
          {{ moreOpen ? t('settingsV79.moreClose') : t('settingsV79.moreOpen') }}
        </button>
      </div>
    </SettingSection>
    <SettingEmbed v-if="hasTelegram" id="telegram"><TelegramSettings :open="ui.settingsOpen" /></SettingEmbed>
    <div v-show="moreOpen" id="notify-more" class="mt-4">
      <SettingEmbed v-if="hasDisk" id="disk"><DiskSettings /></SettingEmbed>
      <SettingEmbed v-if="hasPhone" id="phone"><PhoneSettings :open="ui.settingsOpen" /></SettingEmbed>
    </div>
  </div>
</template>
