<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { ChevronRight, Copy, Dices, ExternalLink, Eye, EyeOff, Send, Smartphone } from 'lucide-vue-next'
import { PHONE_IDLE_CHOICES, type PhoneChannel, type PhonePatch, type PhoneState } from '@ccm/shared'
import { onPhone, phoneSet, phoneState, phoneTest } from '../lib/phone'
import { NTFY_APP_STORE_URL, NTFY_PLAY_URL, ntfySubscribeLink, randomTopic } from '../lib/phoneSetup'
import { openExternal } from '../lib/preview'
import SegmentedControl from './ui/SegmentedControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'

/** Settings › Phone (v76 R6): ntfy / Discord channel; secrets go to the desktop keychain and never come back. */
const props = defineProps<{ open: boolean }>()

const { t } = useI18n()
const state = ref<PhoneState | null>(null)
const server = ref('')
const topic = ref('')
const webhook = ref('')
const note = ref<{ text: string; error: boolean } | null>(null)
const testing = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) void phoneState().then((s) => (state.value = s))
  },
  { immediate: true },
)
const off = onPhone((e) => {
  if ('state' in e) state.value = e.state
})
onBeforeUnmount(off)

const channelOptions = computed(() => [
  { value: 'ntfy' as PhoneChannel, label: t('phone.ntfy') },
  { value: 'discord' as PhoneChannel, label: t('phone.discord') },
])
const idleOptions = computed(() => PHONE_IDLE_CHOICES.map((n) => ({ value: n as number, label: n === 0 ? t('phone.idleAlways') : t('phone.idleMin', { n }) })))
const status = computed(() => (state.value?.configured && state.value.host ? t('phone.configured', { host: state.value.host }) : t('phone.notConfigured')))
const lastError = computed(() => (state.value?.lastError ? t(`phone.error.${state.value.lastError}`) : null))

async function apply(patch: PhonePatch): Promise<boolean> {
  const res = await phoneSet(patch)
  if (res.ok) {
    state.value = res.state
    note.value = null
    if (patch.channel) testedOk.value = null
    return true
  }
  note.value = { text: t(`phone.setError.${res.error}`), error: true }
  return false
}

async function save(): Promise<void> {
  const patch: PhonePatch =
    state.value?.channel === 'discord' ? { discordUrl: webhook.value.trim() } : { ntfyServer: server.value.trim() || 'https://ntfy.sh', ntfyTopic: topic.value.trim() }
  if (await apply(patch)) {
    server.value = ''
    topic.value = ''
    webhook.value = ''
    showTopic.value = false
    testedOk.value = null
  }
}

const clear = (): Promise<boolean> => apply(state.value?.channel === 'discord' ? { discordUrl: '' } : { ntfyServer: '', ntfyTopic: '' })

const testedOk = ref<PhoneChannel | null>(null)

async function test(): Promise<void> {
  testing.value = true
  testedOk.value = null
  const res = await phoneTest()
  testing.value = false
  note.value = res.ok ? { text: t('phone.testOk'), error: false } : { text: t(`phone.error.${res.error}`), error: true }
  if (res.ok) testedOk.value = state.value?.channel ?? null
}

const canSave = computed(() => (state.value?.channel === 'discord' ? !!webhook.value.trim() : !!topic.value.trim()))

const guideSteps = computed(() =>
  state.value?.channel === 'discord'
    ? (['channel', 'webhook', 'copy', 'save', 'test'] as const).map((k) => ({ key: k, text: t(`phone.guideDiscord.${k}`) }))
    : (['install', 'generate', 'subscribe', 'save', 'test'] as const).map((k) => ({ key: k, text: t(`phone.guideNtfy.${k}`) })),
)

const showTopic = ref(false)
function generate(): void {
  topic.value = randomTopic()
  showTopic.value = true
}

// Built only from the unsaved field: after Save the topic is sealed in main and never comes back to the page.
const subscribeLink = computed(() => (state.value?.channel === 'ntfy' ? ntfySubscribeLink(server.value, topic.value.trim()) : null))
const qrSvg = ref('')
let qrRun = 0
watch(
  subscribeLink,
  async (link) => {
    const n = ++qrRun
    const out = link ? await QRCode.toString(link, { type: 'svg', margin: 1 }).catch(() => '') : ''
    if (n === qrRun) qrSvg.value = out
  },
  { immediate: true },
)

async function copyTopic(): Promise<void> {
  try {
    await navigator.clipboard.writeText(topic.value.trim())
    note.value = { text: t('phone.copied'), error: false }
  } catch {
    note.value = { text: t('phone.copyFailed'), error: true }
  }
}
</script>

<template>
  <section v-if="state" aria-labelledby="set-phone" class="mt-6" data-phone-settings>
    <h3 id="set-phone" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('phone.section') }}</h3>
    <div class="ccm-group divide-y divide-line overflow-hidden">
      <ToggleSwitch :model-value="state.enabled" :label="t('phone.enable')" :hint="t('phone.enableHint')" class="px-3" data-phone-enable @update:model-value="(on: boolean) => apply({ enabled: on })" />
      <div class="px-3 py-2">
        <p class="text-sm">{{ t('phone.channel') }}</p>
        <SegmentedControl :model-value="state.channel" :options="channelOptions" :label="t('phone.channel')" fill class="mt-2 w-full" data-phone-channel @update:model-value="(c: PhoneChannel) => apply({ channel: c })" />
        <p class="mt-2 flex min-w-0 items-center gap-1.5 text-2xs" :class="state.configured ? 'text-ink-muted' : 'text-ink-faint'" data-phone-status>
          <Smartphone :size="12" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ status }}</span>
        </p>
      </div>
      <details class="group px-3 py-2" :open="!state.configured" data-phone-guide :data-phone-guide-channel="state.channel">
        <summary class="flex cursor-pointer list-none items-center gap-1 text-sm [&::-webkit-details-marker]:hidden">
          <ChevronRight :size="13" class="shrink-0 text-ink-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />{{ t('phone.guideTitle') }}
        </summary>
        <ol class="mt-2 flex list-decimal flex-col gap-1.5 pl-8 text-xs text-ink-muted marker:text-ink-faint">
          <li v-for="s in guideSteps" :key="s.key" data-phone-guide-step>
            {{ s.text }}
            <span v-if="s.key === 'install'" class="mt-1 flex flex-wrap gap-2">
              <button type="button" class="ccm-btn-plain text-xs" data-phone-store="play" @click="openExternal(NTFY_PLAY_URL)">
                <ExternalLink :size="12" aria-hidden="true" />{{ t('phone.playStore') }}
              </button>
              <button type="button" class="ccm-btn-plain text-xs" data-phone-store="ios" @click="openExternal(NTFY_APP_STORE_URL)">
                <ExternalLink :size="12" aria-hidden="true" />{{ t('phone.appStore') }}
              </button>
            </span>
          </li>
        </ol>
      </details>
      <form class="flex flex-col gap-2 px-3 py-2" autocomplete="off" @submit.prevent="save">
        <template v-if="state.channel === 'ntfy'">
          <label class="flex flex-col gap-1 text-xs text-ink-muted">
            {{ t('phone.server') }}
            <input v-model="server" type="url" spellcheck="false" :placeholder="t('phone.serverPlaceholder')" class="ccm-field font-mono text-xs" data-phone-server />
          </label>
          <div class="flex flex-col gap-1 text-xs text-ink-muted">
            <label for="phone-topic">{{ t('phone.topic') }}</label>
            <div class="flex items-center gap-1">
              <input id="phone-topic" v-model="topic" :type="showTopic ? 'text' : 'password'" spellcheck="false" maxlength="64" class="ccm-field min-w-0 flex-1 font-mono text-xs" data-phone-topic />
              <button
                type="button"
                class="ccm-btn-plain shrink-0 px-1.5"
                :aria-label="showTopic ? t('phone.hideTopic') : t('phone.showTopic')"
                :title="showTopic ? t('phone.hideTopic') : t('phone.showTopic')"
                :aria-pressed="showTopic"
                data-phone-topic-reveal
                @click="showTopic = !showTopic"
              >
                <EyeOff v-if="showTopic" :size="13" aria-hidden="true" /><Eye v-else :size="13" aria-hidden="true" />
              </button>
            </div>
            <span class="text-2xs text-ink-faint">{{ t('phone.topicHint') }}</span>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="ccm-btn-plain text-xs" data-phone-generate @click="generate">
                <Dices :size="13" aria-hidden="true" />{{ t('phone.generate') }}
              </button>
              <button type="button" class="ccm-btn-plain text-xs" :disabled="!topic.trim()" data-phone-copy-topic @click="copyTopic">
                <Copy :size="13" aria-hidden="true" />{{ t('phone.copyTopic') }}
              </button>
            </div>
          </div>
          <div v-if="qrSvg" class="flex items-start gap-3" data-phone-qr>
            <div class="size-28 shrink-0 rounded-inner bg-page p-1 [&>svg]:block [&>svg]:size-full" role="img" :aria-label="t('phone.qrTitle')" data-phone-qr-tile v-html="qrSvg" />
            <div class="min-w-0">
              <p class="text-xs font-medium">{{ t('phone.qrTitle') }}</p>
              <p class="mt-0.5 text-2xs leading-relaxed text-ink-faint">{{ t('phone.qrHint') }}</p>
            </div>
          </div>
        </template>
        <label v-else class="flex flex-col gap-1 text-xs text-ink-muted">
          {{ t('phone.webhook') }}
          <input v-model="webhook" type="password" spellcheck="false" :placeholder="t('phone.webhookPlaceholder')" class="ccm-field font-mono text-xs" data-phone-webhook />
        </label>
        <p class="text-2xs text-ink-faint">{{ t('phone.secretHint') }}</p>
        <div class="flex flex-wrap items-center gap-2">
          <button type="submit" class="ccm-btn" :disabled="!canSave || !state.keychain" data-phone-save>{{ t('phone.save') }}</button>
          <button v-if="state.configured" type="button" class="ccm-btn-plain text-xs" data-phone-clear @click="clear">{{ t('phone.clear') }}</button>
          <button type="button" class="ccm-btn ml-auto" :disabled="!state.configured || testing" data-phone-test @click="test">
            <Send :size="13" aria-hidden="true" />{{ t('phone.test') }}
          </button>
        </div>
      </form>
      <div class="px-3 py-2">
        <p class="text-sm">{{ t('phone.idle') }}</p>
        <p class="mt-0.5 text-2xs text-ink-faint">{{ t('phone.idleHint') }}</p>
        <SegmentedControl :model-value="state.idleMinutes" :options="idleOptions" :label="t('phone.idle')" fill class="mt-2 w-full" data-phone-idle @update:model-value="(n: number) => apply({ idleMinutes: n })" />
      </div>
    </div>
    <p v-if="!state.keychain" class="mt-1 px-3 text-2xs text-st-error" role="alert">{{ t('phone.setError.keychain') }}</p>
    <p v-if="note" class="mt-1 px-3 text-2xs" :class="note.error ? 'text-st-error' : 'text-ink-muted'" aria-live="polite" data-phone-note>{{ note.text }}</p>
    <p v-else-if="lastError" class="mt-1 px-3 text-2xs text-st-error" role="alert" data-phone-error>{{ lastError }}</p>
    <p v-if="testedOk && testedOk === state.channel" class="mt-1 px-3 text-2xs leading-relaxed text-ink-muted" data-phone-test-hint>
      {{ testedOk === 'discord' ? t('phone.testHintDiscord') : t('phone.testHintNtfy') }}
    </p>
    <p class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('phone.privacy') }}</p>
  </section>
</template>
