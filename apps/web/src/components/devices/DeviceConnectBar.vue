<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, KeyRound, Link, LoaderCircle, QrCode, Radar, RefreshCw } from 'lucide-vue-next'
import { useDevicesStore } from '../../stores/devices'
import ToggleSwitch from '../ToggleSwitch.vue'
import DeviceQrPopover from './DeviceQrPopover.vue'

const PAIR_KEY = 'ccm.devices.pairOpen'

const { t } = useI18n()
const store = useDevicesStore()

function readPairOpen(): boolean {
  try {
    return localStorage.getItem(PAIR_KEY) === '1'
  } catch {
    return false
  }
}

const address = ref('')
const code = ref('')
const pairOpen = ref(readPairOpen())
const pairedHint = ref(false)
const qrOpen = ref(false)
const addressInput = ref<HTMLInputElement | null>(null)
const codeInput = ref<HTMLInputElement | null>(null)
const qrButton = ref<HTMLButtonElement | null>(null)

watch(pairOpen, (open) => {
  try {
    localStorage.setItem(PAIR_KEY, open ? '1' : '0')
  } catch {
    // Storage blocked: the toggle still works for this view.
  }
})

const remembered = computed(() => store.devices.filter((d) => !d.online && d.transport === 'wifi'))
const connecting = computed(() => store.busy.has('connect'))
const pairing = computed(() => pairOpen.value && code.value.length > 0)
const rememberedBusy = computed(() => remembered.value.length > 0 && remembered.value.every((d) => store.busy.has(d.id)))

async function togglePair(): Promise<void> {
  pairOpen.value = !pairOpen.value
  if (!pairOpen.value) return
  await nextTick()
  codeInput.value?.focus()
}

function onCode(e: Event): void {
  const el = e.target as HTMLInputElement
  code.value = el.value.replace(/\D/g, '').slice(0, 6)
  el.value = code.value
}

async function submit(): Promise<void> {
  const target = address.value.trim()
  if (!target || connecting.value) return
  store.lastError = null
  pairedHint.value = false
  if (pairing.value) {
    const r = await store.pair(target, code.value)
    if (!r.ok) return
    code.value = ''
    if (r.detail === 'paired') {
      pairedHint.value = true
      await nextTick()
      addressInput.value?.focus()
      addressInput.value?.select()
      return
    }
  } else {
    await store.connect(target)
    if (store.lastError) return
  }
  address.value = ''
}

function discover(): void {
  store.lastError = null
  void store.discover()
}

function connectRemembered(): void {
  store.lastError = null
  void store.connectMany(remembered.value.map((d) => d.id))
}

function setAuto(on: boolean): void {
  store.lastError = null
  void store.setAutoConnect(on)
}

function toggleQr(): void {
  if (qrOpen.value) return closeQr()
  qrOpen.value = true
  store.lastError = null
  void store.startQr()
}

function closeQr(refocus = true): void {
  qrOpen.value = false
  void store.cancelQr()
  if (refocus) qrButton.value?.focus()
}
</script>

<template>
  <div class="relative" data-dev-bar>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-2">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <label for="dev-address" class="sr-only">{{ t('devices.connect.address') }}</label>
        <input
          id="dev-address"
          ref="addressInput"
          v-model="address"
          type="text"
          list="dev-remembered"
          class="ccm-field w-52 min-w-0 font-mono"
          :placeholder="t('devices.connect.placeholder')"
          autocomplete="off"
          spellcheck="false"
          data-dev-address
          @keydown.enter.prevent="submit"
        />
        <datalist id="dev-remembered">
          <option v-for="d in remembered" :key="d.id" :value="d.id">{{ d.name }}</option>
        </datalist>
        <button
          type="button"
          class="ccm-btn-plain text-xs"
          :aria-expanded="pairOpen"
          aria-controls="dev-code-wrap"
          data-dev-pair-toggle
          @click="togglePair"
        >
          <KeyRound :size="13" aria-hidden="true" />{{ t('devices.connect.pairToggle') }}
        </button>
        <span v-if="pairOpen" id="dev-code-wrap" class="contents">
          <label for="dev-code" class="sr-only">{{ t('devices.connect.pairCode') }}</label>
          <input
            id="dev-code"
            ref="codeInput"
            :value="code"
            type="text"
            inputmode="numeric"
            pattern="\d{6}"
            maxlength="6"
            autocomplete="one-time-code"
            class="ccm-field w-28 font-mono tracking-widest"
            :placeholder="t('devices.connect.pairCode')"
            data-dev-code
            @input="onCode"
            @keydown.enter.prevent="submit"
          />
        </span>
        <button type="button" class="ccm-btn ccm-btn-primary" :disabled="!address.trim() || connecting" data-dev-connect @click="submit">
          <LoaderCircle v-if="connecting" :size="14" class="animate-spin" aria-hidden="true" />
          <Link v-else :size="14" aria-hidden="true" />{{ t('devices.connect.connect') }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          ref="qrButton"
          type="button"
          class="ccm-btn"
          aria-haspopup="dialog"
          :aria-expanded="qrOpen"
          data-dev-qr
          @click="toggleQr"
        >
          <QrCode :size="14" aria-hidden="true" />{{ t('devices.qr.button') }}
        </button>
        <button type="button" class="ccm-btn" :disabled="store.busy.has('discover')" data-dev-discover @click="discover">
          <LoaderCircle v-if="store.busy.has('discover')" :size="14" class="animate-spin" aria-hidden="true" />
          <Radar v-else :size="14" aria-hidden="true" />{{ t('devices.discover') }}
        </button>
        <button type="button" class="ccm-btn" :disabled="!remembered.length || rememberedBusy" data-dev-remembered @click="connectRemembered">
          <LoaderCircle v-if="rememberedBusy" :size="14" class="animate-spin" aria-hidden="true" />
          <RefreshCw v-else :size="14" aria-hidden="true" />{{ t('devices.connect.remembered') }}
        </button>
      </div>

      <div class="ml-auto shrink-0">
        <ToggleSwitch :model-value="store.autoConnect" :label="t('devices.connect.autoConnect')" @update:model-value="setAuto" />
      </div>
    </div>

    <p v-if="pairedHint" class="mt-2 flex items-center gap-1.5 text-xs text-ink-muted" role="status" data-dev-paired>
      <Info :size="14" class="shrink-0" aria-hidden="true" />{{ t('devices.connect.pairedHint') }}
    </p>

    <Transition name="ccm-menu">
      <DeviceQrPopover v-if="qrOpen" class="absolute top-full right-0 z-30 mt-2" style="--ccm-origin: top right" @close="closeQr" />
    </Transition>
  </div>
</template>
