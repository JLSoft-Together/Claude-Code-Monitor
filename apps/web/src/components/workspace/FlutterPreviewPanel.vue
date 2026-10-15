<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Circle, CircleCheck, CircleStop, CircleX, Eye, LoaderCircle, Play, RefreshCw, Smartphone, Square, Tag } from 'lucide-vue-next'
import type { FwpEntry, FwpError, FwpScanResult, FwpSnapshot, FwpState } from '@ccm/shared'
import AppSelect, { type SelectOption } from '../AppSelect.vue'
import { desktop } from '../../lib/desktop'
import { EMPTY_SNAPSHOT, flavorsFrom, groupEntries, isLive, mobileDevices, relativeTo } from '../../lib/flutterPreview'
import { baseName } from '../../lib/preview'
import { useRunStore } from '../../stores/run'
import { useWorkspaceStore } from '../../stores/workspace'

const props = withDefaults(defineProps<{ path: string; revision: number; active?: boolean }>(), { active: true })

const { t, te } = useI18n()
const run = useRunStore()
const workspace = useWorkspaceStore()
const DEVICE_KEY = 'ccm.fwp.device'
const LOG_TAIL = 60
const GROUPS = ['here', 'other'] as const

const scan = shallowRef<FwpScanResult | null>(null)
const scanning = ref(true)
const snap = shallowRef<FwpSnapshot>(EMPTY_SNAPSHOT)
const deviceId = ref<string>(readDevice())
const flavor = ref<string>('')
const flavors = ref<string[]>([])
const busy = ref(false)
const actionError = shallowRef<FwpError | null>(null)
const logOpen = ref(false)

function readDevice(): string {
  try {
    return localStorage.getItem(DEVICE_KEY) ?? ''
  } catch {
    return ''
  }
}
watch(deviceId, (id) => {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id)
  } catch {
    // storage off
  }
})

const root = computed(() => scan.value?.root ?? null)
/** Snapshot of the session for this project; another project's session reads as idle here. */
const mine = computed(() => !!root.value && snap.value.root === root.value)
const state = computed<FwpState>(() => (mine.value ? snap.value.state : 'idle'))
const live = computed(() => isLive(state.value))
const entries = computed<FwpEntry[]>(() => (mine.value && snap.value.entries.length ? snap.value.entries : (scan.value?.entries ?? [])))
const groups = computed(() => groupEntries(entries.value, root.value ? relativeTo(root.value, props.path) : null))
const current = computed(() => (mine.value || snap.value.root === null ? snap.value.current : null))
// Not only `failed`: a reload error while running and a lost device after `stopped` carry one too.
const error = computed<FwpError | null>(() => actionError.value ?? (mine.value ? snap.value.error : null))
const logTail = computed(() => (mine.value ? snap.value.log.slice(-LOG_TAIL) : []))

const devices = computed(() => mobileDevices(run.devices))
const deviceOptions = computed<SelectOption<string>[]>(() => devices.value.map((d) => ({ value: d.id, label: d.name, hint: d.emulator ? `${d.platform} · emulator` : d.platform })))
const flavorOptions = computed<SelectOption<string>[]>(() => [{ value: '', label: t('fwp.noFlavor') }, ...flavors.value.map((f) => ({ value: f, label: f }))])
const emulators = computed(() => run.emulators.slice(0, 3))

watch(
  devices,
  (list) => {
    if (!list.some((d) => d.id === deviceId.value) && list[0]) deviceId.value = list[0].id
  },
  { immediate: true },
)

const STATE: Record<FwpState, { icon: typeof Circle; cls: string; spin?: boolean }> = {
  idle: { icon: Circle, cls: 'text-st-idle' },
  starting: { icon: LoaderCircle, cls: 'text-st-working', spin: true },
  running: { icon: CircleCheck, cls: 'text-st-working' },
  reloading: { icon: LoaderCircle, cls: 'text-st-working', spin: true },
  failed: { icon: CircleX, cls: 'text-st-error' },
  stopped: { icon: CircleStop, cls: 'text-st-stale' },
}

function errorText(e: FwpError): string {
  if (e.code === 'build' && e.build) return t('fwp.error.build', { file: baseName(e.build.file), line: e.build.line, message: e.build.message })
  const key = `fwp.error.${e.code}`
  return te(key) ? t(key, { detail: e.detail ?? '' }) : t('fwp.error.other', { code: e.code })
}

let scanSeq = 0
async function rescan(): Promise<void> {
  const seq = ++scanSeq
  const res = await desktop?.fwpScan?.(props.path).catch(() => null)
  if (seq !== scanSeq) return
  scan.value = res ?? { flutter: false, root: null, entries: [] }
  scanning.value = false
}

async function loadFlavors(): Promise<void> {
  if (!root.value) return
  flavors.value = flavorsFrom(await run.loadConfigs(root.value).catch(() => []))
  if (flavor.value && !flavors.value.includes(flavor.value)) flavor.value = ''
}

async function start(): Promise<void> {
  if (!root.value || !deviceId.value || busy.value) return
  busy.value = true
  actionError.value = null
  try {
    const res = await desktop?.fwpStart?.(root.value, deviceId.value, flavor.value || null).catch(() => null)
    if (res && !res.ok && res.error.code !== 'cancelled') actionError.value = res.error
  } finally {
    busy.value = false
  }
}

async function stop(): Promise<void> {
  actionError.value = null
  await desktop?.fwpStop?.().catch(() => null)
}

async function show(e: FwpEntry): Promise<void> {
  if (e.skipped) return
  actionError.value = null
  const res = await desktop?.fwpShow?.(e.id).catch(() => null)
  if (res && !res.ok) actionError.value = res.error
}

function openRunPane(): void {
  if (root.value) workspace.openRun(root.value)
}

let off: (() => void) | null = null

onMounted(async () => {
  off = desktop?.onFwpState?.((s) => (snap.value = s)) ?? null
  const initial = await desktop?.fwpGet?.().catch(() => null)
  if (initial) snap.value = initial
  await rescan()
  void loadFlavors()
  await run.ensure(true)
  if (!devices.value.length) void run.loadEmulators()
})

onBeforeUnmount(() => off?.())

watch(
  () => props.revision,
  () => {
    if (!live.value) void rescan()
  },
)
watch(
  () => props.path,
  async () => {
    scanning.value = true
    await rescan()
    void loadFlavors()
  },
)
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface text-ink" :aria-label="t('fwp.title')" data-fwp-panel>
    <div class="ccm-material flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1" role="toolbar" :aria-label="t('fwp.toolbar')">
      <AppSelect v-if="deviceOptions.length" v-model="deviceId" :options="deviceOptions" :label="t('fwp.device')" :icon="Smartphone" size="sm" data-fwp-device />
      <AppSelect v-if="flavors.length" v-model="flavor" :options="flavorOptions" :label="t('fwp.flavor')" :icon="Tag" size="sm" />
      <button
        v-if="!live"
        type="button"
        class="ccm-btn-primary shrink-0 gap-1"
        :disabled="!scan?.flutter || !deviceId || !deviceOptions.length || busy"
        data-fwp-start
        @click="start"
      >
        <Play :size="13" aria-hidden="true" />{{ state === 'idle' ? t('fwp.start') : t('fwp.restart') }}
      </button>
      <button v-else type="button" class="ccm-btn shrink-0 gap-1" data-fwp-stop @click="stop">
        <Square :size="12" aria-hidden="true" />{{ t('fwp.stop') }}
      </button>
      <span class="flex-1" />
      <span class="flex min-w-0 shrink items-center gap-1 text-2xs" role="status" data-fwp-state>
        <component :is="STATE[state].icon" :size="13" class="shrink-0" :class="[STATE[state].cls, STATE[state].spin ? 'ccm-spin' : '']" aria-hidden="true" />
        <span class="shrink-0 text-ink-muted">{{ t(`fwp.state.${state}`) }}</span>
        <span v-if="mine && snap.progress && live" class="truncate text-ink-faint" :title="snap.progress">{{ snap.progress }}</span>
      </span>
    </div>

    <p v-if="error" class="flex shrink-0 items-start gap-2 border-b border-line bg-st-error-soft px-3 py-1.5 text-xs text-ink" role="alert" data-fwp-error>
      <CircleX :size="14" class="mt-0.5 shrink-0 text-st-error" aria-hidden="true" />
      <span class="min-w-0 flex-1 break-words">{{ errorText(error) }}</span>
    </p>

    <div v-if="scan?.flutter && !deviceOptions.length && run.devicesLoaded" class="flex shrink-0 flex-col gap-1.5 border-b border-line px-3 py-2 text-xs" data-fwp-no-device>
      <p class="flex items-center gap-1.5 text-ink"><Smartphone :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />{{ t('fwp.noDevice') }}</p>
      <p class="text-ink-faint">{{ t('fwp.noDeviceHint') }}</p>
      <div class="flex flex-wrap gap-1">
        <button v-for="e in emulators" :key="e.id" type="button" class="ccm-btn shrink-0" @click="run.launchEmulator(e, root ?? undefined)">{{ t('fwp.launchEmulator', { name: e.name }) }}</button>
        <button type="button" class="ccm-btn-plain shrink-0 gap-1" :title="t('fwp.refreshDevices')" @click="run.refreshDevices()"><RefreshCw :size="13" aria-hidden="true" />{{ t('fwp.refreshDevices') }}</button>
        <button type="button" class="ccm-btn-plain shrink-0" @click="openRunPane">{{ t('fwp.openRun') }}</button>
      </div>
    </div>

    <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <p v-if="scanning" class="flex items-center gap-2 p-4 text-xs text-ink-muted"><LoaderCircle :size="14" class="ccm-spin" aria-hidden="true" />{{ t('fwp.scanning') }}</p>
      <p v-else-if="!scan?.flutter" class="p-4 text-xs text-ink-muted" data-fwp-not-flutter>{{ t('fwp.notFlutter') }}</p>
      <div v-else-if="!entries.length" class="flex max-w-md flex-col gap-1.5 p-4 text-xs" data-fwp-empty>
        <p class="text-ink">{{ t('fwp.empty') }}</p>
        <p class="text-ink-faint">{{ t('fwp.emptyHint', { code: '@Preview()' }) }}</p>
      </div>
      <template v-else>
        <p v-if="state === 'idle'" class="px-3 pt-2.5 text-2xs text-ink-faint">{{ t('fwp.hint') }}</p>
        <template v-for="group in GROUPS" :key="group">
          <section v-if="groups[group].length" class="pt-2" :data-fwp-group="group">
            <h3 class="px-3 pb-1 text-2xs font-semibold text-ink-muted">{{ group === 'here' ? t('fwp.thisFile') : t('fwp.otherFiles') }}</h3>
            <ul class="px-1.5 pb-1">
              <li v-for="e in groups[group]" :key="e.id">
                <button
                  type="button"
                  class="group flex w-full min-w-0 items-start gap-2 rounded-inner px-2 py-1.5 text-left"
                  :class="[e.skipped ? 'cursor-default' : 'hover:bg-fill', current === e.id ? 'bg-accent-soft' : '']"
                  :disabled="!!e.skipped"
                  :aria-current="current === e.id ? 'true' : undefined"
                  :title="current === e.id ? (state === 'running' || state === 'reloading' ? t('fwp.showing') : t('fwp.selected')) : undefined"
                  :data-fwp-entry="e.id"
                  @click="show(e)"
                >
                  <Eye v-if="current === e.id" :size="14" class="mt-0.5 shrink-0 text-accent-ink" aria-hidden="true" />
                  <Circle v-else :size="14" class="mt-0.5 shrink-0" :class="e.skipped ? 'text-ink-disabled' : 'text-ink-faint'" aria-hidden="true" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-xs" :class="e.skipped ? 'text-ink-muted' : current === e.id ? 'font-semibold text-accent-ink' : 'text-ink'">{{ e.label }}</span>
                    <span class="truncate text-2xs text-ink-faint" :title="`${e.file}:${e.line}`">
                      {{ group === 'other' ? `${e.file} · ` : '' }}{{ e.symbol.startsWith('?') ? '' : `${e.symbol} · ` }}{{ t('fwp.line', { line: e.line }) }}
                    </span>
                    <span v-if="e.skipped" class="text-2xs text-ink-muted" data-fwp-skipped>{{ t(`fwp.skipped.${e.skipped}`) }}</span>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </template>
      </template>
    </div>

    <details v-if="logTail.length" class="shrink-0 border-t border-line" :open="logOpen" @toggle="logOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="cursor-pointer px-3 py-1 text-2xs text-ink-muted">{{ t('fwp.log') }}</summary>
      <pre class="ccm-scroll max-h-40 overflow-auto whitespace-pre-wrap break-words bg-well px-3 py-2 font-mono text-2xs text-well-ink">{{ logTail.join('\n') }}</pre>
    </details>
  </section>
</template>
