<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, RefreshCw, Settings2, Smartphone, Trash2, Unplug, X } from 'lucide-vue-next'
import type { AdbDevice } from '@ccm/shared'
import { useDevicesStore } from '../../stores/devices'
import { useUiStore } from '../../stores/ui'
import DeviceCaptureDialog from './DeviceCaptureDialog.vue'
import DeviceConnectBar from './DeviceConnectBar.vue'
import DeviceUiTestDialog from './DeviceUiTestDialog.vue'
import DeviceAppDataDialog from './DeviceAppDataDialog.vue'
import DeviceRow from './DeviceRow.vue'
import DeviceEmulators from './DeviceEmulators.vue'
import { hasEmulators } from '../../lib/devices'
import { ROW_GRID } from './meta'

const { t, te } = useI18n()
const store = useDevicesStore()
const ui = useUiStore()

const errorText = computed(() => {
  const code = store.lastError?.code
  if (!code) return ''
  return t(te(`devices.error.${code}`) ? `devices.error.${code}` : 'devices.error.denied')
})

const allSelected = computed(() => store.devices.length > 0 && store.selected.size === store.devices.length)
const someSelected = computed(() => store.selected.size > 0 && !allSelected.value)
const ids = (list: AdbDevice[]): string[] => list.map((d) => d.id)
const captureFor = ref<AdbDevice | null>(null)
const testFor = ref<AdbDevice | null>(null)
const dataFor = ref<AdbDevice | null>(null)

function batch(fn: () => Promise<void>): void {
  store.lastError = null
  void fn()
}

onMounted(() => void store.open().catch(() => undefined))
// Settings is an overlay, so the view stays mounted while the Android SDK is set there.
watch(
  () => ui.settingsOpen,
  (open, was) => {
    if (was && !open) void store.refresh().catch(() => undefined)
  },
)
onBeforeUnmount(() => void store.close().catch(() => undefined))
</script>

<template>
  <main class="mx-auto w-full max-w-[1560px] flex-1 px-4 py-5 sm:px-6 sm:py-6" data-devices>
    <div class="min-w-0">
      <h2 class="text-2xl font-semibold tracking-tight">{{ t('devices.title') }}</h2>
      <p class="mt-1 max-w-[80ch] text-sm text-ink-muted">{{ t('devices.subtitle') }}</p>
    </div>

    <div v-if="!store.adbFound" class="mt-5 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-card bg-warning-soft px-4 py-3" role="alert" data-dev-noadb>
      <CircleAlert :size="16" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <p class="min-w-0 flex-1 basis-60 text-sm">{{ t('devices.empty.noAdb') }}</p>
      <button type="button" class="ccm-btn shrink-0" @click="ui.settingsOpen = true">
        <Settings2 :size="14" aria-hidden="true" />{{ t('devices.empty.openSettings') }}
      </button>
    </div>

    <template v-else>
      <DeviceConnectBar class="mt-5" />

      <div v-if="store.lastError" class="mt-3 flex items-start gap-1.5 text-xs text-warning" role="alert" data-dev-error>
        <CircleAlert :size="14" class="mt-px shrink-0" aria-hidden="true" />
        <p class="min-w-0 flex-1">
          {{ errorText }}
          <span v-if="store.lastError.detail" class="ml-1 line-clamp-3 font-mono text-2xs break-all text-ink-muted" :title="store.lastError.detail">{{ store.lastError.detail }}</span>
        </p>
        <button type="button" class="ccm-btn-plain -my-1.5 shrink-0" :aria-label="t('devices.dismiss')" :title="t('devices.dismiss')" @click="store.lastError = null">
          <X :size="13" aria-hidden="true" />
        </button>
      </div>

      <div
        v-if="store.selected.size"
        class="mt-4 flex flex-wrap items-center gap-2 rounded-control bg-accent-soft px-3 py-1.5"
        role="toolbar"
        :aria-label="t('devices.batch.selected', { n: store.selected.size })"
        data-dev-batch
      >
        <span class="text-xs font-medium text-accent-ink">{{ t('devices.batch.selected', { n: store.selected.size }) }}</span>
        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="ccm-btn"
            :disabled="!store.selectedOfflineWifi.length"
            data-dev-batch-action="connect"
            @click="batch(() => store.connectMany(ids(store.selectedOfflineWifi)))"
          >
            <RefreshCw :size="13" aria-hidden="true" />{{ t('devices.batch.connect') }}
          </button>
          <button
            type="button"
            class="ccm-btn"
            :disabled="!store.selectedOnlineWifi.length"
            data-dev-batch-action="disconnect"
            @click="batch(() => store.disconnect(ids(store.selectedOnlineWifi)))"
          >
            <Unplug :size="13" aria-hidden="true" />{{ t('devices.batch.disconnect') }}
          </button>
          <button
            type="button"
            class="ccm-btn ccm-btn-danger"
            :disabled="!store.selectedOffline.length"
            data-dev-batch-action="forget"
            @click="batch(() => store.remove(ids(store.selectedOffline)))"
          >
            <Trash2 :size="13" aria-hidden="true" />{{ t('devices.batch.forget') }}
          </button>
          <button type="button" class="ccm-btn-plain" :aria-label="t('devices.batch.clear')" :title="t('devices.batch.clear')" @click="store.selectAll(false)">
            <X :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>

      <template v-if="store.loaded">
        <div v-if="!store.devices.length" class="mt-4 flex flex-col items-center gap-2 rounded-card bg-surface px-4 py-10 text-center shadow-card" data-dev-empty>
          <Smartphone :size="22" class="text-ink-faint" aria-hidden="true" />
          <p class="text-sm text-ink-muted">{{ t('devices.empty.none') }}</p>
        </div>

        <section v-else class="mt-4" :aria-label="t('devices.list')">
          <div class="flex min-w-0 items-center gap-3 px-3 pb-1.5 text-2xs font-medium text-ink-faint" :class="ROW_GRID">
            <input
              type="checkbox"
              class="size-4 shrink-0 cursor-pointer accent-accent"
              :checked="allSelected"
              :indeterminate="someSelected"
              :aria-label="t('devices.selectAll')"
              data-dev-select-all
              @change="store.selectAll(!allSelected)"
            />
            <span class="md:hidden">{{ t('devices.list') }} · {{ store.devices.length }}</span>
            <span class="hidden md:block">{{ t('devices.col.status') }}</span>
            <span class="hidden md:block">{{ t('devices.col.name') }}</span>
            <span class="hidden md:block">{{ t('devices.col.id') }}</span>
            <span class="hidden md:block">{{ t('devices.col.transport') }}</span>
          </div>
          <div role="list" class="ccm-group overflow-hidden">
            <DeviceRow v-for="d in store.devices" :key="d.id" :device="d" @capture="(dev) => (captureFor = dev)" @ui-test="(dev) => (testFor = dev)" @app-data="(dev) => (dataFor = dev)" />
          </div>
        </section>
      </template>
      <DeviceEmulators v-if="hasEmulators" />
    </template>
    <DeviceCaptureDialog :open="!!captureFor" :device-id="captureFor?.id ?? null" :device-name="captureFor?.name ?? ''" @close="captureFor = null" />
    <DeviceUiTestDialog :open="!!testFor" :device-id="testFor?.id ?? null" :device-name="testFor?.name ?? ''" @close="testFor = null" />
    <DeviceAppDataDialog :open="!!dataFor" :device-id="dataFor?.id ?? null" :device-name="dataFor?.name ?? ''" @close="dataFor = null" />
  </main>
</template>
