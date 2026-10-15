<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Check,
  ChevronDown,
  CirclePlay,
  Gauge,
  LoaderCircle,
  MonitorSmartphone,
  RefreshCw,
  RotateCw,
  Settings2,
  Smartphone,
  Square,
  Stethoscope,
  TabletSmartphone,
  Zap,
} from 'lucide-vue-next'
import { isRunLive, type RunConfig, type RunDevice, type RunEmulator, type RunKind, type RunState } from '@ccm/shared'
import { desktop } from '../../lib/desktop'
import { projectMark } from '../../lib/runUi'
import { RUN_BUSY_STATES, useRunStore } from '../../stores/run'

const props = defineProps<{ root: string; blocked: boolean }>()
const emit = defineEmits<{ editConfigs: []; toolchain: [] }>()

const { t } = useI18n()
const run = useRunStore()

const GROUPS: RunKind[] = ['flutter', 'android', 'custom']
const MENU_ROW =
  'group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-disabled'

const config = computed(() => run.selectedConfig(props.root))
const devices = computed(() => run.devicesFor(config.value))
const device = computed(() => run.selectedDevice(props.root, config.value))
const needsDevice = computed(() => !!config.value && config.value.type !== 'custom' && config.value.device === 'selected')
const pair = computed(() => (config.value ? run.sessionOf(props.root, config.value.id, config.value.type === 'custom' ? null : (device.value?.id ?? null)) : null))
const focused = computed(() => run.focusedSession(props.root))

const grouped = computed(() =>
  GROUPS.map((kind) => ({ kind, items: run.configsFor(props.root).filter((c) => c.type === kind) })).filter((g) => g.items.length),
)

const pending = ref(false)
/** Android plan §6 table: config / device menus are locked while the picked pair builds, installs or launches. */
const LOCKING: readonly RunState[] = ['before-launch', 'building', 'installing', 'launching']
const locked = computed(() => !!pair.value && LOCKING.includes(pair.value.state))
/** No ready device: Run opens the device menu (with emulators) instead of being a dead button. */
const noDevice = computed(() => needsDevice.value && device.value?.state !== 'ready')
const canRun = computed(() => !pending.value && !props.blocked && !!config.value && !(pair.value && RUN_BUSY_STATES.includes(pair.value.state)))
const runTitle = computed(() => (noDevice.value ? t('run.action.runNoDevice') : pairLive.value ? t('run.action.rerun') : t('run.action.run')))

const project = computed(() => (config.value && config.value.type !== 'custom' ? run.projectAt(config.value.cwd) : null))
const configTitle = computed(() => {
  const c = config.value
  if (!c) return t('run.config.label')
  const p = project.value
  const parts = [`${t('run.config.label')}: ${c.name}`]
  if (p) {
    const m = projectMark(p)
    const guessed = p.kind === 'android' && c.type === 'android' && !!p.modules.find((x) => x.path === c.module)?.guessed
    parts.push(`${t(`run.project.${m.label}`)}${guessed ? ` (${t('run.config.guessed')})` : ''}`)
    if (guessed) parts.push(t('run.project.reason.guessed'))
  }
  if (locked.value) parts.push(t('run.config.locked'))
  return parts.join(' — ')
})
const hiddenDevices = computed(() => (config.value?.type === 'flutter' ? run.devices.filter((d) => d.source === 'flutter').length - devices.value.length : 0))
const pairLive = computed(() => !!pair.value && isRunLive(pair.value.state))
const canStop = computed(() => !!focused.value && isRunLive(focused.value.state) && focused.value.state !== 'stopping')
// A custom `flutter run --machine` command reports an appId; main refuses reload outside debug.
const canReload = computed(() => {
  const s = focused.value
  return !!s && s.state === 'running' && ((s.type === 'flutter' && s.mode === 'debug') || (s.type === 'custom' && !!s.appId))
})
const devtools = computed(() => (focused.value && isRunLive(focused.value.state) ? focused.value.devtoolsUri : null))

async function act(fn: () => Promise<unknown>): Promise<void> {
  pending.value = true
  try {
    await fn()
  } finally {
    pending.value = false
  }
}

function startRun(): Promise<void> {
  if (noDevice.value) return toggle('device')
  return act(() => run.start(props.root))
}
const stopRun = (): void => void (focused.value && run.stop(focused.value.id, props.root))
const reload = (full: boolean): void => void (focused.value && run.reload(focused.value.id, full, props.root))
const openDevtools = (): void => void (devtools.value && desktop?.openExternal?.(devtools.value))

type MenuId = 'config' | 'device'
const menu = ref<MenuId | null>(null)
const bar = ref<HTMLElement | null>(null)
const launching = ref<string | null>(null)

async function toggle(id: MenuId): Promise<void> {
  if (locked.value && menu.value !== id) return
  menu.value = menu.value === id ? null : id
  if (!menu.value) return
  if (id === 'device') void run.loadEmulators()
  await nextTick()
  const list = items()
  ;(list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus()
}

function close(refocus = false): void {
  const id = menu.value
  menu.value = null
  if (refocus && id) bar.value?.querySelector<HTMLElement>(`[data-run-menu-button="${id}"]`)?.focus()
}

const items = (): HTMLElement[] => [...(bar.value?.querySelectorAll<HTMLElement>('[data-run-menu] [role^="menuitem"]:not(:disabled)') ?? [])]

function onMenuKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    return close(true)
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[next]?.focus()
}

function onOutside(e: PointerEvent): void {
  if (menu.value && !bar.value?.querySelector('[data-run-menu]')?.contains(e.target as Node) && !(e.target as Element).closest?.('[data-run-menu-button]')) close()
}
onMounted(() => document.addEventListener('pointerdown', onOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

function pickConfig(c: RunConfig): void {
  run.select(props.root, { config: c.id })
  close(true)
}

function pickDevice(d: RunDevice): void {
  run.select(props.root, { device: d.id })
  close(true)
}

async function launch(e: RunEmulator): Promise<void> {
  launching.value = e.id
  close(true)
  try {
    await run.launchEmulator(e, props.root)
  } finally {
    launching.value = null
  }
}

function deviceIcon(d: RunDevice) {
  if (d.platform.startsWith('web') || /^(windows|macos|darwin|linux)/.test(d.platform)) return MonitorSmartphone
  return d.emulator ? TabletSmartphone : Smartphone
}

const stateText = (d: RunDevice): string | null => (d.state === 'unauthorized' ? t('run.device.unauthorized') : d.state === 'offline' ? t('run.device.offline') : null)
const launchingName = computed(() => run.emulators.find((e) => e.id === launching.value)?.name ?? launching.value)
</script>

<template>
  <div ref="bar" class="flex min-w-0 flex-1 items-center gap-1" role="toolbar" :aria-label="t('run.toolbar')">
    <div class="relative min-w-0 shrink">
      <button
        type="button"
        class="ccm-btn-plain max-w-56 min-w-0 text-xs text-ink"
        aria-haspopup="menu"
        :aria-expanded="menu === 'config'"
        :disabled="locked"
        :title="configTitle"
        data-run-menu-button="config"
        @click="toggle('config')"
      >
        <span class="truncate">{{ config?.name ?? t('run.config.none') }}</span>
        <ChevronDown :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
      </button>
      <Transition name="ccm-menu">
        <div
          v-if="menu === 'config'"
          class="ccm-menu absolute top-full left-0 z-20 mt-1 flex max-h-80 w-64 flex-col overflow-y-auto p-1"
          style="--ccm-origin: top left"
          role="menu"
          :aria-label="t('run.config.label')"
          data-run-menu
          @keydown="onMenuKey"
        >
          <template v-for="g in grouped" :key="g.kind">
            <p class="px-2 pt-1.5 pb-1 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t(`run.config.group.${g.kind}`) }}</p>
            <button v-for="c in g.items" :key="c.id" type="button" role="menuitemradio" :aria-checked="c.id === config?.id" :class="MENU_ROW" :title="c.cwd" @click="pickConfig(c)">
              <Check :size="13" class="shrink-0" :class="c.id === config?.id ? '' : 'invisible'" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ c.name }}</span>
            </button>
          </template>
          <p v-if="!grouped.length" class="px-2 py-1.5 text-xs text-ink-muted">{{ t('run.config.none') }}</p>
          <div class="mx-2 my-1 h-px bg-line" role="separator" />
          <button type="button" role="menuitem" :class="MENU_ROW" data-run-edit-configs @click="(close(true), emit('editConfigs'))">
            <Settings2 :size="14" class="shrink-0 text-ink-muted group-focus-visible:text-on-accent" aria-hidden="true" />
            <span class="truncate">{{ t('run.config.edit') }}</span>
          </button>
          <button type="button" role="menuitem" :class="MENU_ROW" data-run-toolchain-open @click="(close(true), emit('toolchain'))">
            <Stethoscope :size="14" class="shrink-0 text-ink-muted group-focus-visible:text-on-accent" aria-hidden="true" />
            <span class="truncate">{{ t('run.config.toolchain') }}</span>
          </button>
        </div>
      </Transition>
    </div>

    <div v-if="config?.type !== 'custom'" class="relative min-w-0 shrink">
      <button
        type="button"
        class="ccm-btn-plain max-w-48 min-w-0 text-xs text-ink"
        aria-haspopup="menu"
        :aria-expanded="menu === 'device'"
        :disabled="!config || locked"
        :title="locked ? `${t('run.device.label')} — ${t('run.config.locked')}` : device ? `${t('run.device.label')}: ${device.name}` : t('run.device.choose')"
        data-run-menu-button="device"
        @click="toggle('device')"
      >
        <LoaderCircle v-if="launching" :size="13" class="ccm-spin shrink-0" aria-hidden="true" />
        <component :is="deviceIcon(device)" v-else-if="device" :size="13" class="shrink-0" aria-hidden="true" />
        <span class="truncate" :class="device ? '' : 'text-ink-muted'">{{ launching ? t('run.device.launching', { name: launchingName }) : (device?.name ?? t('run.device.none')) }}</span>
        <ChevronDown :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
      </button>
      <Transition name="ccm-menu">
        <div
          v-if="menu === 'device'"
          class="ccm-menu absolute top-full left-0 z-20 mt-1 flex max-h-80 w-72 flex-col overflow-y-auto p-1"
          style="--ccm-origin: top left"
          role="menu"
          :aria-label="t('run.device.label')"
          data-run-menu
          @keydown="onMenuKey"
        >
          <p class="px-2 pt-1.5 pb-1 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('run.device.label') }}</p>
          <button
            v-for="d in devices"
            :key="`${d.source}:${d.id}`"
            type="button"
            role="menuitemradio"
            :aria-checked="d.id === device?.id"
            :disabled="d.state !== 'ready'"
            :class="[MENU_ROW, stateText(d) ? 'h-auto py-1' : '']"
            :title="d.id"
            @click="pickDevice(d)"
          >
            <component :is="deviceIcon(d)" :size="14" class="shrink-0" aria-hidden="true" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{{ d.name }}</span>
              <span v-if="stateText(d)" class="truncate text-2xs text-warning">{{ stateText(d) }}</span>
            </span>
            <span v-if="d.emulator" class="shrink-0 text-2xs text-ink-faint group-focus-visible:text-on-accent">{{ t('run.device.emulator') }}</span>
            <Check v-if="d.id === device?.id" :size="14" class="shrink-0" aria-hidden="true" />
          </button>
          <p v-if="!devices.length" class="px-2 py-1.5 text-xs text-ink-muted">{{ t('run.device.noDevices') }}</p>
          <p v-if="hiddenDevices > 0" class="px-2 py-1 text-2xs text-ink-faint" data-run-devices-hidden>{{ t('run.device.hidden') }}</p>
          <div class="mx-2 my-1 h-px bg-line" role="separator" />
          <p class="px-2 pt-1 pb-1 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('run.device.launch') }}</p>
          <button v-for="e in run.emulators" :key="`${e.source}:${e.id}`" type="button" role="menuitem" :class="MENU_ROW" :title="e.id" data-run-emulator @click="launch(e)">
            <TabletSmartphone :size="14" class="shrink-0 text-ink-muted group-focus-visible:text-on-accent" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ e.name }}</span>
          </button>
          <p v-if="!run.emulators.length" class="px-2 py-1.5 text-xs text-ink-muted">{{ t('run.device.noEmulators') }}</p>
        </div>
      </Transition>
    </div>
    <button v-if="config?.type !== 'custom'" type="button" class="ccm-btn-plain shrink-0" :title="t('run.device.refresh')" :aria-label="t('run.device.refresh')" @click="run.refreshDevices()">
      <RefreshCw :size="13" aria-hidden="true" />
    </button>

    <span class="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />

    <button
      type="button"
      class="ccm-btn-plain shrink-0 enabled:text-accent-ink"
      :disabled="!canRun"
      :title="runTitle"
      :aria-label="runTitle"
      :data-run-no-device="noDevice ? '' : undefined"
      data-run-start
      @click="startRun"
    >

      <CirclePlay :size="15" aria-hidden="true" />
    </button>
    <button type="button" class="ccm-btn-plain shrink-0 enabled:text-st-error" :disabled="!canStop" :title="t('run.action.stop')" :aria-label="t('run.action.stop')" data-run-stop @click="stopRun">
      <Square :size="13" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="ccm-btn-plain shrink-0"
      :disabled="!canReload"
      :title="canReload ? t('run.action.reload') : `${t('run.action.reload')} — ${t('run.action.flutterOnly')}`"
      :aria-label="t('run.action.reload')"
      data-run-reload
      @click="reload(false)"
    >
      <Zap :size="14" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="ccm-btn-plain shrink-0"
      :disabled="!canReload"
      :title="canReload ? t('run.action.restart') : `${t('run.action.restart')} — ${t('run.action.flutterOnly')}`"
      :aria-label="t('run.action.restart')"
      data-run-restart
      @click="reload(true)"
    >
      <RotateCw :size="14" aria-hidden="true" />
    </button>
    <button type="button" class="ccm-btn-plain shrink-0" :disabled="!devtools" :title="t('run.action.devtools')" :aria-label="t('run.action.devtools')" data-run-devtools @click="openDevtools">
      <Gauge :size="14" aria-hidden="true" />
    </button>
  </div>
</template>
