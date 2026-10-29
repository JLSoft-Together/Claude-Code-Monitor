<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, ExternalLink, LoaderCircle, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-vue-next'
import type { DevErrorCode, DevLaunch, DevManifest, DevUiChange, DevUiState } from '@ccm/shared'
import { baseName } from '../../lib/preview'
import { densitySteps, densityValue, FONT_SCALES, fontValue, isLaunchUri, isPackageName, launchRows, shortActivity, type LaunchRow } from '../../lib/deviceUiTest'
import { devLaunch, devManifest, devUiRead, devUiRestore, devUiSet } from '../../lib/devices'
import { retireOverlay } from '../../lib/motion'
import { tabProject, useWorkspaceStore } from '../../stores/workspace'
import { dirKey } from '../../stores/favorites'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ToggleSwitch from '../ToggleSwitch.vue'

const props = defineProps<{ open: boolean; deviceId: string | null; deviceName: string }>()
const emit = defineEmits<{ close: [] }>()

const { t, te } = useI18n()
const workspace = useWorkspaceStore()
const ROOT_KEY = 'ccm.devices.uiTestRoot'

const dialog = ref<HTMLElement | null>(null)
const state = ref<DevUiState | null>(null)
const loading = ref(false)
const busy = ref<string | null>(null)
const error = ref<{ code: DevErrorCode; detail?: string } | null>(null)
const note = ref<string | null>(null)
const manifest = ref<DevManifest | null>(null)
const manifestLoading = ref(false)
const pkg = ref('')
const uri = ref('')
const root = ref<string>('')
let gen = 0
let restoreFocus: HTMLElement | null = null

const roots = computed(() => {
  const seen = new Map<string, string>()
  for (const tab of workspace.tabs) {
    const dir = tabProject(tab, (k) => workspace.panes.find((p) => p.key === k))
    if (dir && !seen.has(dirKey(dir))) seen.set(dirKey(dir), dir)
  }
  return [...seen.values()]
})
const pkgOrNull = computed(() => (isPackageName(pkg.value.trim()) ? pkg.value.trim() : null))
const rows = computed(() => (manifest.value?.ok ? launchRows(manifest.value.activities) : []))
const steps = computed(() => (state.value ? densitySteps(state.value.density.physical) : []))
const fontOptions = FONT_SCALES.map((f) => ({ value: f, label: `${f}×` }))
const densityOptions = computed(() => steps.value.map((s) => ({ value: s.value, label: t(`deviceTools.uiTest.densityStep.${s.key}`), title: s.value ? `${s.value} dpi` : undefined })))
const localeOptions = computed(() => {
  const tags = new Set(manifest.value?.ok ? manifest.value.locales : [])
  const cur = state.value?.locale.current
  if (cur) tags.add(cur)
  return [{ value: '', label: t('deviceTools.uiTest.localeSystem') }, ...[...tags].sort().map((v) => ({ value: v, label: v }))]
})
const localeBlocked = computed(() => (!state.value?.locale.supported ? 'deviceTools.uiTest.localeUnsupported' : !pkgOrNull.value ? 'deviceTools.uiTest.localeNeedsPkg' : null))

const errorText = computed(() => {
  const code = error.value?.code
  if (!code) return ''
  return t(te(`devices.error.${code}`) ? `devices.error.${code}` : 'devices.error.denied')
})

function fail(r: { ok: false; error: DevErrorCode; detail?: string }): void {
  error.value = { code: r.error, detail: r.detail }
}

async function read(): Promise<void> {
  const id = props.deviceId
  if (!id) return
  const my = gen
  loading.value = true
  try {
    const r = await devUiRead(id, pkgOrNull.value)
    if (my !== gen) return
    if (r.ok) state.value = r.state
    else fail(r)
  } finally {
    if (my === gen) loading.value = false
  }
}

async function loadManifest(): Promise<void> {
  const dir = root.value
  manifest.value = null
  if (!dir) return
  const my = gen
  manifestLoading.value = true
  try {
    const m = await devManifest(dir)
    if (my !== gen) return
    manifest.value = m
    if (m.ok && m.pkg) pkg.value = m.pkg
  } finally {
    if (my === gen) manifestLoading.value = false
  }
}

async function pickRoot(dir: string): Promise<void> {
  root.value = dir
  try {
    localStorage.setItem(ROOT_KEY, dir)
  } catch {
    // remembered pick is a convenience only
  }
  await loadManifest()
  await read()
}

async function apply(change: DevUiChange, key: string): Promise<void> {
  const id = props.deviceId
  if (!id || busy.value) return
  busy.value = key
  error.value = null
  note.value = null
  try {
    const r = await devUiSet(id, change, pkgOrNull.value)
    if (r.ok) state.value = r.state
    else fail(r)
  } finally {
    busy.value = null
  }
}

async function restoreAll(): Promise<void> {
  const id = props.deviceId
  if (!id || busy.value) return
  busy.value = 'restore'
  error.value = null
  try {
    const r = await devUiRestore(id, pkgOrNull.value)
    if (r.ok) state.value = r.state
    else fail(r)
  } finally {
    busy.value = null
  }
}

async function launch(target: DevLaunch, key: string): Promise<void> {
  const id = props.deviceId
  if (!id || busy.value) return
  busy.value = key
  error.value = null
  note.value = null
  try {
    const r = await devLaunch(id, target)
    if (r.ok) note.value = r.detail ?? t('deviceTools.open.launched')
    else fail(r)
  } finally {
    busy.value = null
  }
}

function runRow(row: LaunchRow): void {
  if (row.kind === 'uri') {
    uri.value = row.target
    void launch({ kind: 'uri', uri: row.target, pkg: pkgOrNull.value }, row.key)
  } else if (pkgOrNull.value) void launch({ kind: 'activity', pkg: pkgOrNull.value, activity: row.target }, row.key)
}

function openUri(): void {
  const u = uri.value.trim()
  if (isLaunchUri(u)) void launch({ kind: 'uri', uri: u, pkg: pkgOrNull.value }, 'uri')
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

function savedRoot(): string {
  let saved = ''
  try {
    saved = localStorage.getItem(ROOT_KEY) ?? ''
  } catch {
    saved = ''
  }
  return roots.value.find((r) => dirKey(r) === dirKey(saved)) ?? roots.value[0] ?? ''
}

watch(
  () => props.open,
  async (open) => {
    gen++
    if (!open) {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    state.value = null
    error.value = null
    note.value = null
    pkg.value = ''
    uri.value = ''
    root.value = savedRoot()
    void loadManifest().then(read)
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('[data-uitest-close]')?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-4 py-[5vh]" @mousedown.self="emit('close')">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="device-uitest-title"
          class="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden ccm-sheet"
          data-device-uitest
          @keydown="trap"
        >
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line py-2.5 pr-3 pl-4">
            <SlidersHorizontal :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="device-uitest-title" class="truncate text-sm font-semibold">{{ t('deviceTools.uiTest.title', { name: deviceName }) }}</h2>
              <p v-if="state?.sdk" class="text-2xs text-ink-faint">{{ t('deviceTools.uiTest.sdk', { n: state.sdk }) }}</p>
            </div>
            <span v-if="state?.changed.length" class="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-medium text-ink" data-uitest-changed>
              <CircleAlert :size="11" class="text-warning" aria-hidden="true" />{{ t('deviceTools.uiTest.changed', { n: state.changed.length }) }}
            </span>
            <button type="button" class="ccm-btn" :disabled="!state?.changed.length || !!busy" :title="t('deviceTools.uiTest.restoreHint')" data-uitest-restore @click="restoreAll">
              <LoaderCircle v-if="busy === 'restore'" :size="13" class="ccm-spin" aria-hidden="true" />
              <RotateCcw v-else :size="13" aria-hidden="true" />{{ t('deviceTools.uiTest.restore') }}
            </button>
            <button type="button" class="ccm-btn-plain" :title="t('deviceTools.uiTest.close')" :aria-label="t('deviceTools.uiTest.close')" data-uitest-close @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </div>

          <div v-if="error || note" class="flex shrink-0 items-start gap-1.5 border-b border-line px-4 py-2 text-xs" :class="error ? 'bg-warning-soft' : 'bg-fill'" role="status" data-uitest-message>
            <CircleAlert v-if="error" :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
            <p class="min-w-0 flex-1">
              {{ error ? errorText : note }}
              <span v-if="error?.detail" class="ml-1 line-clamp-2 font-mono text-2xs break-all text-ink-muted" :title="error.detail">{{ error.detail }}</span>
            </p>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label class="flex min-w-0 flex-col gap-1 text-2xs text-ink-muted">
                {{ t('deviceTools.uiTest.project') }}
                <select class="ccm-field min-w-0 text-xs" :value="root" data-uitest-root @change="pickRoot(($event.target as HTMLSelectElement).value)">
                  <option value="">{{ t('deviceTools.uiTest.noProject') }}</option>
                  <option v-for="r in roots" :key="r" :value="r" :title="r">{{ baseName(r) }}</option>
                </select>
              </label>
              <label class="flex min-w-0 flex-col gap-1 text-2xs text-ink-muted">
                {{ t('deviceTools.uiTest.pkg') }}
                <input v-model="pkg" class="ccm-field min-w-0 font-mono text-xs" spellcheck="false" maxlength="255" :placeholder="t('deviceTools.uiTest.pkgPlaceholder')" data-uitest-pkg @change="read" />
              </label>
            </div>

            <p v-if="loading && !state" class="mt-4 flex items-center gap-2 text-xs text-ink-muted">
              <LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('deviceTools.uiTest.loading') }}
            </p>

            <section v-if="state" class="mt-4" :aria-label="t('deviceTools.uiTest.display')" data-uitest-display>
              <h3 class="text-2xs font-semibold text-ink-faint">{{ t('deviceTools.uiTest.display') }}</h3>
              <div class="divide-y divide-line">
                <ToggleSwitch
                  :model-value="state.night === 'yes'"
                  :label="t('deviceTools.uiTest.dark')"
                  :disabled="!!busy"
                  data-uitest-dark
                  @update:model-value="(on: boolean) => apply({ key: 'night', value: on ? 'yes' : 'no' }, 'night')"
                />
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                  <span class="min-w-0 flex-1 text-sm text-ink">{{ t('deviceTools.uiTest.fontScale') }}</span>
                  <SegmentedControl
                    :options="fontOptions"
                    :model-value="fontValue(state.fontScale)"
                    :label="t('deviceTools.uiTest.fontScale')"
                    :disabled="!!busy"
                    data-uitest-font
                    @update:model-value="(v: number) => apply({ key: 'fontScale', value: v }, 'font')"
                  />
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                  <span class="min-w-0 flex-1 text-sm text-ink">{{ t('deviceTools.uiTest.density') }}</span>
                  <SegmentedControl
                    :options="densityOptions"
                    :model-value="densityValue(state)"
                    :label="t('deviceTools.uiTest.density')"
                    :disabled="!!busy"
                    data-uitest-density
                    @update:model-value="(v: number) => apply({ key: 'density', value: v || null }, 'density')"
                  />
                </div>
                <ToggleSwitch
                  :model-value="state.animationsOff"
                  :label="t('deviceTools.uiTest.animationsOff')"
                  :hint="t('deviceTools.uiTest.animationsHint')"
                  :disabled="!!busy"
                  data-uitest-anim
                  @update:model-value="(off: boolean) => apply({ key: 'animations', off }, 'anim')"
                />
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm text-ink">{{ t('deviceTools.uiTest.locale') }}</p>
                    <p v-if="localeBlocked" class="mt-0.5 text-2xs text-ink-faint">{{ t(localeBlocked) }}</p>
                  </div>
                  <select
                    class="ccm-field min-w-28 text-xs"
                    :value="state.locale.current ?? ''"
                    :disabled="!!localeBlocked || !!busy"
                    :aria-label="t('deviceTools.uiTest.locale')"
                    data-uitest-locale
                    @change="apply({ key: 'locale', pkg: pkgOrNull!, value: ($event.target as HTMLSelectElement).value }, 'locale')"
                  >
                    <option v-for="o in localeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </div>
              </div>
            </section>

            <section class="mt-4" :aria-label="t('deviceTools.open.title')" data-uitest-open>
              <h3 class="text-2xs font-semibold text-ink-faint">{{ t('deviceTools.open.title') }}</h3>
              <form class="mt-1.5 flex min-w-0 gap-1.5" @submit.prevent="openUri">
                <input
                  v-model="uri"
                  class="ccm-field min-w-0 flex-1 font-mono text-xs"
                  spellcheck="false"
                  maxlength="2048"
                  :aria-label="t('deviceTools.open.uri')"
                  :placeholder="t('deviceTools.open.uriPlaceholder')"
                  data-uitest-uri
                />
                <button type="submit" class="ccm-btn shrink-0" :disabled="!isLaunchUri(uri.trim()) || !!busy" data-uitest-go>
                  <LoaderCircle v-if="busy === 'uri'" :size="13" class="ccm-spin" aria-hidden="true" />
                  <ExternalLink v-else :size="13" aria-hidden="true" />{{ t('deviceTools.open.go') }}
                </button>
              </form>
              <p v-if="manifestLoading" class="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                <LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('deviceTools.open.loading') }}
              </p>
              <p v-else-if="manifest && !manifest.ok && manifest.error === 'no-manifest'" class="mt-2 text-2xs text-ink-faint">{{ t('deviceTools.open.noManifest') }}</p>
              <p v-else-if="manifest?.ok && !rows.length" class="mt-2 text-2xs text-ink-faint">{{ t('deviceTools.open.none', { file: manifest.manifest }) }}</p>
              <ul v-else-if="rows.length" class="ccm-group mt-2 overflow-hidden" data-uitest-rows>
                <li v-for="row in rows" :key="row.key" class="flex min-h-9 min-w-0 items-center gap-2 px-3 py-1 text-xs hover:bg-fill">
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-mono" :title="row.target">{{ row.kind === 'uri' ? row.target : shortActivity(row.target, pkgOrNull) }}</p>
                    <p v-if="row.kind === 'uri'" class="truncate text-2xs text-ink-faint" :title="row.activity">{{ shortActivity(row.activity, pkgOrNull) }}</p>
                  </div>
                  <span v-if="row.launcher && row.kind === 'activity'" class="shrink-0 rounded-full bg-fill px-1.5 text-2xs text-ink-muted">{{ t('deviceTools.open.launcher') }}</span>
                  <button
                    type="button"
                    class="ccm-btn-plain shrink-0 text-xs"
                    :disabled="!!busy || (row.kind === 'activity' && !pkgOrNull)"
                    :data-uitest-launch="row.kind"
                    @click="runRow(row)"
                  >
                    <LoaderCircle v-if="busy === row.key" :size="13" class="ccm-spin" aria-hidden="true" />
                    <Play v-else :size="13" aria-hidden="true" />{{ row.kind === 'uri' ? t('deviceTools.open.go') : t('deviceTools.open.start') }}
                  </button>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
