<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Camera, LoaderCircle, Pencil, RefreshCw, SlidersHorizontal, TabletSmartphone, Trash2, Unplug, Usb, Wifi } from 'lucide-vue-next'
import type { AdbDevice } from '@ccm/shared'
import { useInlineEdit } from '../../composables/useInlineEdit'
import { hasDeviceCapture, hasDeviceUiTest } from '../../lib/devices'
import { useDevicesStore } from '../../stores/devices'
import { OTHER_STATE, ROW_GRID, rowActions, STATE_META, stateOf, type RowAction } from './meta'

const props = defineProps<{ device: AdbDevice }>()
const emit = defineEmits<{ capture: [device: AdbDevice]; uiTest: [device: AdbDevice] }>()

const { t } = useI18n()
const store = useDevicesStore()

const selected = computed(() => store.selected.has(props.device.id))
const busy = computed(() => store.busy.has(props.device.id))
const state = computed(() => stateOf(props.device))
const meta = computed(() => STATE_META[state.value] ?? OTHER_STATE)
const actions = computed(() => rowActions(props.device))
const ready = computed(() => props.device.online && props.device.state === 'ready')
const canCapture = computed(() => hasDeviceCapture && ready.value)
const canTest = computed(() => hasDeviceUiTest && ready.value)
const TRANSPORT_ICON = { usb: Usb, wifi: Wifi, emulator: TabletSmartphone }
const ACTION_ICON = { toWifi: Wifi, disconnect: Unplug, reconnect: RefreshCw, forget: Trash2 }

function run(a: RowAction): void {
  const id = props.device.id
  store.lastError = null
  if (a === 'toWifi') void store.toWifi(id)
  else if (a === 'disconnect') void store.disconnect([id])
  else if (a === 'reconnect') void store.connectMany([id])
  else void store.remove([id])
}

const { active: editing, draft, input, start, commit, cancel } = useInlineEdit()
const renameButton = ref<HTMLButtonElement | null>(null)

function save(value: string): boolean {
  const alias = value && value !== (props.device.model ?? props.device.id) ? value : null
  if (alias !== props.device.alias) {
    store.lastError = null
    void store.setAlias(props.device.id, alias)
  }
  return true
}

async function finish(save_: boolean): Promise<void> {
  if (!editing.value) return
  if (save_) commit(save)
  else cancel()
  await nextTick()
  renameButton.value?.focus()
}
</script>

<template>
  <div
    class="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 transition-colors duration-(--ccm-dur-fast)"
    :class="[ROW_GRID, selected ? 'bg-accent-soft' : 'hover:bg-fill']"
    role="listitem"
    :data-dev-row="device.id"
    :data-selected="selected || undefined"
    @click="store.toggle(device.id)"
  >
    <input
      type="checkbox"
      class="size-4 shrink-0 cursor-pointer accent-accent"
      :checked="selected"
      :aria-label="t('devices.select', { name: device.name })"
      @click.stop
      @change="store.toggle(device.id)"
    />

    <span class="inline-flex w-30 min-w-0 shrink-0 items-center gap-1.5 text-xs md:w-auto" :class="meta.cls" data-dev-status>
      <LoaderCircle v-if="busy" :size="14" class="shrink-0 animate-spin" aria-hidden="true" />
      <component :is="meta.icon" v-else :size="14" class="shrink-0" aria-hidden="true" />
      <span class="truncate">{{ t(`devices.state.${state}`) }}</span>
    </span>

    <div class="flex min-w-0 flex-1 basis-40 flex-col md:basis-auto">
      <form v-if="editing" class="flex min-w-0" @click.stop @submit.prevent="finish(true)">
        <input
          ref="input"
          v-model="draft"
          maxlength="64"
          class="ccm-field w-full min-w-0 text-sm!"
          :aria-label="t('devices.action.rename')"
          :placeholder="device.model ?? device.id"
          data-dev-alias
          @keydown.esc.stop.prevent="finish(false)"
          @blur="finish(true)"
        />
      </form>
      <div v-else class="group/name flex min-w-0 items-center gap-1">
        <span
          class="min-w-0 truncate text-sm font-medium"
          :class="selected ? 'text-accent-ink' : 'text-ink'"
          :title="device.name"
          @dblclick.stop="start(device.alias ?? device.name, true)"
        >{{ device.name }}</span>
        <span v-if="device.alias && device.model" class="hidden min-w-0 shrink truncate text-2xs text-ink-faint lg:inline" :title="device.model">{{ device.model }}</span>
        <button
          ref="renameButton"
          type="button"
          class="ccm-btn-plain shrink-0 opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100"
          :aria-label="`${t('devices.action.rename')}: ${device.name}`"
          :title="t('devices.action.rename')"
          @click.stop="start(device.alias ?? device.name, true)"
        >
          <Pencil :size="12" aria-hidden="true" />
        </button>
      </div>
      <p v-if="state === 'unauthorized'" class="text-2xs text-ink-muted">{{ t('devices.state.unauthorizedHint') }}</p>
    </div>

    <span class="min-w-0 flex-1 basis-32 truncate font-mono text-2xs text-ink-muted md:basis-auto" :title="device.id">{{ device.id }}</span>

    <span class="inline-flex w-fit shrink-0 items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-2xs font-medium text-ink-muted">
      <component :is="TRANSPORT_ICON[device.transport]" :size="11" aria-hidden="true" />{{ t(`devices.transport.${device.transport}`) }}
    </span>

    <div class="ml-auto flex shrink-0 items-center justify-end gap-0.5" @click.stop>
      <button
        v-if="canCapture"
        type="button"
        class="ccm-btn-plain text-xs"
        :disabled="busy"
        :title="t('deviceTools.capture.button')"
        data-dev-action="capture"
        @click="emit('capture', device)"
      >
        <Camera :size="13" aria-hidden="true" />
        <span class="sr-only lg:not-sr-only">{{ t('deviceTools.capture.button') }}</span>
      </button>
      <button
        v-if="canTest"
        type="button"
        class="ccm-btn-plain text-xs"
        :disabled="busy"
        :title="t('deviceTools.uiTest.button')"
        data-dev-action="uiTest"
        @click="emit('uiTest', device)"
      >
        <SlidersHorizontal :size="13" aria-hidden="true" />
        <span class="sr-only lg:not-sr-only">{{ t('deviceTools.uiTest.button') }}</span>
      </button>
      <button
        v-for="a in actions"
        :key="a"
        type="button"
        class="ccm-btn-plain text-xs"
        :class="a === 'forget' ? 'hover:text-st-error!' : ''"
        :disabled="busy"
        :title="t(`devices.action.${a}`)"
        :data-dev-action="a"
        @click="run(a)"
      >
        <component :is="ACTION_ICON[a]" :size="13" aria-hidden="true" />
        <span class="sr-only lg:not-sr-only">{{ t(`devices.action.${a}`) }}</span>
      </button>
    </div>
  </div>
</template>
