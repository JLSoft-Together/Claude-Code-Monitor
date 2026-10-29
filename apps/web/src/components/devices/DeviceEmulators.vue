<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, CircleOff, Eraser, LoaderCircle, Play, RefreshCw, Snowflake, Square, TabletSmartphone, X } from 'lucide-vue-next'
import type { AvdInfo } from '@ccm/shared'
import { avdDetails, avdState, emulatorKey, type AvdRowState } from '../../lib/emulators'
import { useDevicesStore } from '../../stores/devices'
import { useEmulatorsStore } from '../../stores/emulators'
import { useUiStore } from '../../stores/ui'

const { t, te } = useI18n()
const store = useEmulatorsStore()
const devices = useDevicesStore()
const ui = useUiStore()

const STATE = {
  running: { icon: CircleCheck, cls: 'text-success' },
  starting: { icon: LoaderCircle, cls: 'text-accent-ink' },
  stopped: { icon: CircleOff, cls: 'text-ink-muted' },
} satisfies Record<AvdRowState, { icon: unknown; cls: string }>

const errorText = computed(() => {
  const code = store.lastError?.code
  if (!code) return ''
  if (te(`emulators.error.${code}`)) return t(`emulators.error.${code}`)
  return t(te(`devices.error.${code}`) ? `devices.error.${code}` : 'devices.error.denied')
})

const rows = computed(() => store.avds.map((a) => ({ avd: a, state: avdState(a, store.starting), details: avdDetails(a, (n) => t('emulators.api', { n })) })))
const disabled = (a: AvdInfo, state: AvdRowState): boolean => store.busy.has(a.name) || state === 'starting'

onMounted(() => void store.load())
watch(
  () => emulatorKey(devices.devices),
  (key, was) => {
    if (store.loaded && key !== was) void store.load()
  },
)
watch(
  () => ui.settingsOpen,
  (open, was) => {
    if (was && !open) void store.load()
  },
)
onBeforeUnmount(() => store.dispose())
</script>

<template>
  <section class="mt-6" :aria-label="t('emulators.title')" data-emulators>
    <div class="flex min-w-0 items-center gap-2 px-3 pb-1.5">
      <h3 class="text-sm font-semibold">{{ t('emulators.title') }}</h3>
      <span v-if="store.loaded && !store.missing" class="text-2xs text-ink-faint">{{ store.avds.length }}</span>
      <button
        type="button"
        class="ccm-btn-plain ml-auto text-xs"
        :disabled="store.loading"
        :title="t('emulators.refresh')"
        data-avd-refresh
        @click="store.load()"
      >
        <RefreshCw :size="13" :class="store.loading ? 'animate-spin' : ''" aria-hidden="true" />
        <span class="sr-only sm:not-sr-only">{{ t('emulators.refresh') }}</span>
      </button>
    </div>

    <div v-if="store.lastError" class="mb-2 flex items-start gap-1.5 px-3 text-xs text-warning" role="alert" data-avd-error>
      <CircleAlert :size="14" class="mt-px shrink-0" aria-hidden="true" />
      <p class="min-w-0 flex-1">
        {{ errorText }}
        <span v-if="store.lastError.detail" class="ml-1 font-mono text-2xs break-all text-ink-muted">{{ store.lastError.detail }}</span>
      </p>
      <button type="button" class="ccm-btn-plain -my-1.5 shrink-0" :aria-label="t('devices.dismiss')" :title="t('devices.dismiss')" @click="store.lastError = null">
        <X :size="13" aria-hidden="true" />
      </button>
    </div>

    <div v-if="store.missing" class="flex items-start gap-2 rounded-card bg-surface px-4 py-3 text-sm text-ink-muted shadow-card" data-avd-missing>
      <TabletSmartphone :size="16" class="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p class="min-w-0 flex-1">{{ t('emulators.missing') }}</p>
    </div>
    <div v-else-if="store.loaded && !store.avds.length" class="flex items-start gap-2 rounded-card bg-surface px-4 py-3 text-sm text-ink-muted shadow-card" data-avd-empty>
      <TabletSmartphone :size="16" class="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p class="min-w-0 flex-1">{{ t('emulators.empty') }}</p>
    </div>

    <div v-else-if="rows.length" role="list" class="ccm-group overflow-hidden">
      <div
        v-for="r in rows"
        :key="r.avd.name"
        role="listitem"
        class="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 hover:bg-fill"
        :data-avd-row="r.avd.name"
        :data-avd-state="r.state"
      >
        <span class="inline-flex w-28 shrink-0 items-center gap-1.5 text-xs" :class="STATE[r.state].cls" data-avd-status>
          <LoaderCircle v-if="store.busy.has(r.avd.name)" :size="14" class="shrink-0 animate-spin" aria-hidden="true" />
          <component :is="STATE[r.state].icon" v-else :size="14" class="shrink-0" :class="r.state === 'starting' ? 'animate-spin' : ''" aria-hidden="true" />
          <span class="truncate">{{ t(`emulators.state.${r.state}`) }}</span>
        </span>

        <div class="flex min-w-0 flex-1 basis-48 flex-col">
          <span class="min-w-0 truncate text-sm font-medium text-ink" :title="r.avd.name">{{ r.avd.displayName }}</span>
          <span v-if="r.details" class="min-w-0 truncate text-2xs text-ink-muted" :title="r.details">{{ r.details }}</span>
        </div>

        <span v-if="r.avd.serial" class="shrink-0 font-mono text-2xs text-ink-muted">{{ r.avd.serial }}</span>

        <div class="ml-auto flex shrink-0 items-center justify-end gap-0.5">
          <template v-if="r.state === 'running'">
            <button type="button" class="ccm-btn-plain text-xs" :disabled="store.busy.has(r.avd.name)" :title="t('emulators.action.stop')" data-avd-action="stop" @click="store.stop(r.avd.name)">
              <Square :size="13" aria-hidden="true" />
              <span class="sr-only lg:not-sr-only">{{ t('emulators.action.stop') }}</span>
            </button>
          </template>
          <template v-else>
            <button type="button" class="ccm-btn-plain text-xs" :disabled="disabled(r.avd, r.state)" :title="t('emulators.action.start')" data-avd-action="start" @click="store.start(r.avd.name, 'normal')">
              <Play :size="13" aria-hidden="true" />
              <span class="sr-only lg:not-sr-only">{{ t('emulators.action.start') }}</span>
            </button>
            <button type="button" class="ccm-btn-plain text-xs" :disabled="disabled(r.avd, r.state)" :title="t('emulators.action.coldHint')" data-avd-action="cold" @click="store.start(r.avd.name, 'cold')">
              <Snowflake :size="13" aria-hidden="true" />
              <span class="sr-only lg:not-sr-only">{{ t('emulators.action.cold') }}</span>
            </button>
            <button
              type="button"
              class="ccm-btn-plain text-xs hover:text-st-error!"
              :disabled="disabled(r.avd, r.state)"
              :title="t('emulators.action.wipeHint')"
              data-avd-action="wipe"
              @click="store.start(r.avd.name, 'wipe')"
            >
              <Eraser :size="13" aria-hidden="true" />
              <span class="sr-only lg:not-sr-only">{{ t('emulators.action.wipe') }}</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
