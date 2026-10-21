<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { CircleAlert, CircleCheck, CircleOff, LoaderCircle } from 'lucide-vue-next'
import type { QrStatus } from '@ccm/shared'
import { useDevicesStore } from '../../stores/devices'

const emit = defineEmits<{ close: [refocus: boolean] }>()

const { t, te } = useI18n()
const store = useDevicesStore()
const root = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const svg = ref('')

// The payload comes from main (`WIFI:T:ADB;S:orrery-…;P:…;;`), and qrcode only emits its own <svg> markup.
let rendered = 0
watch(
  () => store.qr?.payload,
  async (payload) => {
    const n = ++rendered
    const out = payload ? await QRCode.toString(payload, { type: 'svg', margin: 1 }).catch(() => '') : ''
    if (n === rendered) svg.value = out
  },
  { immediate: true },
)

const starting = computed(() => !store.qr && store.busy.has('qr'))
/** Start failed or the session ended on its own. */
const status = computed<QrStatus | null>(() => store.qr?.status ?? (starting.value ? null : 'failed'))
/** Why the start failed (e.g. mdns-unavailable), shown instead of the generic "Pairing failed." */
const startError = computed(() => {
  const code = !store.qr && !starting.value ? store.lastError?.code : undefined
  return code ? t(te(`devices.error.${code}`) ? `devices.error.${code}` : 'devices.error.denied') : ''
})
const live = computed(() => starting.value || status.value === 'waiting' || status.value === 'pairing' || status.value === 'connecting')

const STATUS_META: Record<QrStatus, { icon: typeof CircleCheck; cls: string; spin?: boolean }> = {
  waiting: { icon: LoaderCircle, cls: 'text-ink-muted', spin: true },
  pairing: { icon: LoaderCircle, cls: 'text-ink-muted', spin: true },
  connecting: { icon: LoaderCircle, cls: 'text-ink-muted', spin: true },
  connected: { icon: CircleCheck, cls: 'text-success' },
  failed: { icon: CircleAlert, cls: 'text-warning' },
  timeout: { icon: CircleAlert, cls: 'text-warning' },
  cancelled: { icon: CircleOff, cls: 'text-ink-muted' },
}
const meta = computed(() => (status.value ? STATUS_META[status.value] : STATUS_META.waiting))

function retry(): void {
  store.lastError = null
  void store.startQr()
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  emit('close', true)
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Element | null
  if (root.value?.contains(target) || target?.closest?.('[data-dev-qr]')) return
  emit('close', false)
}

onMounted(() => {
  document.addEventListener('pointerdown', onOutside, true)
  cancelButton.value?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <div
    ref="root"
    class="ccm-menu w-72 max-w-[calc(100vw-2rem)] p-4"
    role="dialog"
    aria-labelledby="dev-qr-title"
    aria-describedby="dev-qr-help"
    data-dev-qr-popover
    @keydown="onKey"
  >
    <h3 id="dev-qr-title" class="text-sm font-semibold">{{ t('devices.qr.title') }}</h3>
    <p id="dev-qr-help" class="mt-1 text-xs text-ink-muted">{{ t('devices.qr.help') }}</p>

    <!-- The tile alone stays black on white in every theme so phones can scan it. -->
    <div
      v-if="svg && store.qr"
      class="mx-auto mt-3 size-48 rounded-inner bg-page p-1 [&>svg]:block [&>svg]:size-full"
      role="img"
      :aria-label="t('devices.qr.title')"
      data-dev-qr-tile
      v-html="svg"
    />
    <div v-else class="mx-auto mt-3 grid size-48 place-items-center rounded-inner bg-fill text-ink-muted">
      <LoaderCircle v-if="live" :size="20" class="animate-spin" aria-hidden="true" />
      <component :is="meta.icon" v-else :size="20" :class="meta.cls" aria-hidden="true" />
    </div>

    <p class="mt-3 flex min-w-0 gap-1.5 text-xs" :class="[meta.cls, startError ? 'items-start' : 'items-center']" role="status" data-dev-qr-status>
      <component :is="meta.icon" :size="14" class="shrink-0" :class="[meta.spin ? 'animate-spin' : '', startError ? 'mt-px' : '']" aria-hidden="true" />
      <span v-if="startError" class="min-w-0 line-clamp-3" :title="startError">{{ startError }}</span>
      <span v-else class="truncate">{{ t(`devices.qr.${status ?? 'waiting'}`) }}</span>
    </p>
    <p v-if="store.qr?.detail && !live" class="mt-1 line-clamp-3 font-mono text-2xs break-all text-ink-muted" :title="store.qr.detail">{{ store.qr.detail }}</p>

    <div class="mt-4 flex justify-end gap-2">
      <button v-if="!live && status !== 'connected'" type="button" class="ccm-btn" @click="retry">{{ t('devices.qr.retry') }}</button>
      <button ref="cancelButton" type="button" class="ccm-btn" data-dev-qr-cancel @click="emit('close', true)">
        {{ live ? t('devices.qr.cancel') : t('devices.qr.close') }}
      </button>
    </div>
  </div>
</template>
