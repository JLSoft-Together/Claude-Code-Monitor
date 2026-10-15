<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowLeft, ArrowUp, CircleAlert, Copy, Download, LayoutTemplate, LoaderCircle, Plus, Settings2, Trash2, X } from 'lucide-vue-next'
import { DEFAULT_RUN_TEMPLATES, type FlutterMode, type RunCommandPreview, type RunConfig, type RunKind, type RunTemplates } from '@ccm/shared'
import { retireOverlay } from '../../lib/motion'
import { appModules, cloneConfig, configChanges, configIssues, envRows, issueKey, moveItem, newConfig, rowsToEnv, sameConfig, tidyIssueText, type EnvRow } from '../../lib/runUi'
import { dirKey } from '../../stores/favorites'
import { useRunStore } from '../../stores/run'
import ToggleSwitch from '../ToggleSwitch.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'

const props = defineProps<{ open: boolean; root: string }>()
const emit = defineEmits<{ close: [] }>()

const { t, te } = useI18n()
const run = useRunStore()

const GROUPS: RunKind[] = ['flutter', 'android', 'custom']
const MODES: FlutterMode[] = ['debug', 'profile', 'release']
const PREVIEW_MS = 250

const original = ref<RunConfig[]>([])
const working = ref<RunConfig[]>([])
const rows = ref<Record<string, EnvRow[]>>({})
const selectedId = ref<string | null>(null)
const notice = ref<{ text: string; error?: boolean } | null>(null)
const busy = ref(false)
const loading = ref(false)
const addOpen = ref(false)
const sheet = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

function reset(list: readonly RunConfig[], keep?: string | null): void {
  original.value = list.map(cloneConfig)
  working.value = list.map(cloneConfig)
  rows.value = Object.fromEntries(list.map((c) => [c.id, envRows(c.env)]))
  const want = keep ?? run.selectedConfig(props.root)?.id
  selectedId.value = list.find((c) => c.id === want)?.id ?? list[0]?.id ?? null
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      addOpen.value = false
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    notice.value = null
    view.value = 'configs'
    loading.value = true
    void run.loadTemplates()
    if (!run.detected(props.root)) await run.detect(props.root)
    reset(await run.loadConfigs(props.root))
    loading.value = false
    await nextTick()
    sheet.value?.querySelector<HTMLElement>('[data-config-row][aria-current="true"], [data-config-add]')?.focus()
  },
  { immediate: true },
)

const projects = computed(() => run.projectsFor(props.root))
const current = computed(() => working.value.find((c) => c.id === selectedId.value) ?? null)
const currentRows = computed<EnvRow[]>(() => (current.value ? (rows.value[current.value.id] ?? []) : []))

const materialize = (c: RunConfig): RunConfig => ({ ...c, env: rowsToEnv(rows.value[c.id] ?? []) })
const isDirty = (c: RunConfig): boolean => {
  const before = original.value.find((o) => o.id === c.id)
  return !before || !sameConfig(before, materialize(c))
}

const grouped = computed(() => GROUPS.map((kind) => ({ kind, items: working.value.filter((c) => c.type === kind) })).filter((g) => g.items.length))

function rel(dir: string): string {
  const r = props.root.replace(/[\\/]+$/, '')
  if (dirKey(dir) === dirKey(r)) return '.'
  return dirKey(dir).startsWith(`${dirKey(r)}\\`) ? dir.slice(r.length + 1).replace(/\\/g, '/') : dir
}

const withCurrent = (list: string[], value: string): string[] => (value && !list.includes(value) ? [value, ...list] : list)

const projectDirs = computed(() => {
  const c = current.value
  if (!c) return []
  const dirs =
    c.type === 'custom'
      ? [props.root, ...projects.value.map((p) => p.dir)]
      : projects.value.filter((p) => p.kind === c.type).map((p) => p.dir)
  return withCurrent([...new Set(dirs)], c.cwd)
})

const project = computed(() => {
  const c = current.value
  return c ? (projects.value.find((p) => p.kind === c.type && dirKey(p.dir) === dirKey(c.cwd)) ?? null) : null
})
const entrypoints = computed(() => (current.value?.type === 'flutter' ? withCurrent(project.value?.kind === 'flutter' ? project.value.entrypoints : [], current.value.entrypoint) : []))
const flavors = computed(() => (project.value?.kind === 'flutter' ? project.value.flavors : []))
const modules = computed(() => (current.value?.type === 'android' ? withCurrent(project.value ? appModules(project.value) : [], current.value.module) : []))
const devices = computed(() => run.devicesFor(current.value))
const pinnedMissing = computed(() => {
  const c = current.value
  return c && c.type !== 'custom' && c.device !== 'selected' && !devices.value.some((d) => d.id === c.device) ? c.device : null
})
const modeOptions = computed(() => MODES.map((m) => ({ value: m, label: t(`run.configs.modes.${m}`) })))

const issues = computed(() => (current.value ? configIssues(current.value, currentRows.value) : []))
const issueText = (i: { code: string; name?: string }): string => {
  const key = `run.configs.invalid.${i.code}`
  return te(key) ? t(key, { name: i.name ?? '' }) : t('run.error.unknown', { code: i.code })
}

const preview = ref<RunCommandPreview | null>(null)
const previewing = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null
let previewSeq = 0

function previewDevice(c: RunConfig): string | null {
  if (c.type === 'custom') return null
  return c.device === 'selected' ? (run.selectedDevice(props.root, c)?.id ?? null) : c.device
}

watch(
  () => props.open && current.value && JSON.stringify(materialize(current.value)),
  () => {
    if (previewTimer) clearTimeout(previewTimer)
    const c = current.value
    if (!props.open || !c || issues.value.length) {
      preview.value = null
      previewing.value = false
      return
    }
    previewing.value = true
    const seq = ++previewSeq
    previewTimer = setTimeout(async () => {
      const res = await run.preview(props.root, JSON.parse(JSON.stringify(materialize(c))) as RunConfig, previewDevice(c))
      if (seq !== previewSeq) return
      preview.value = res
      previewing.value = false
    }, PREVIEW_MS)
  },
  { immediate: true },
)
onBeforeUnmount(() => previewTimer && clearTimeout(previewTimer))

const previewErrors = computed(() =>
  (preview.value?.errors ?? []).map((e) => {
    const { key, params } = issueKey(e, ['validate', 'env', 'error'], te)
    return tidyIssueText(t(key, params))
  }),
)

/** "Edit configuration templates…": defaults for detected and new configs, saved in app data by main. */
const view = ref<'configs' | 'templates'>('configs')
const tpl = ref<RunTemplates>(structuredClone(DEFAULT_RUN_TEMPLATES))
const tplNotice = ref<{ text: string; error?: boolean } | null>(null)

async function openTemplates(): Promise<void> {
  tpl.value = JSON.parse(JSON.stringify((await run.loadTemplates()) ?? DEFAULT_RUN_TEMPLATES)) as RunTemplates
  tplNotice.value = null
  view.value = 'templates'
  await nextTick()
  sheet.value?.querySelector<HTMLElement>('[data-template-back]')?.focus()
}

const tplValid = computed(() => /^[A-Za-z0-9_]*$/.test(tpl.value.flutter.flavor) && /^[A-Za-z0-9_]{1,64}$/.test(tpl.value.android.variant))

async function saveTemplates(): Promise<void> {
  if (!tplValid.value) return
  busy.value = true
  try {
    const saved = await run.saveTemplates(tpl.value)
    tplNotice.value = saved ? { text: t('run.templates.saved') } : { text: t('run.templates.failed'), error: true }
    if (saved) {
      const fresh = await run.loadConfigs(props.root)
      const autoUntouched = working.value.every((c) => !c.id.startsWith('auto-') || !isDirty(c))
      if (autoUntouched) reset(fresh, selectedId.value)
    }
  } finally {
    busy.value = false
  }
}

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

async function focusName(): Promise<void> {
  await nextTick()
  sheet.value?.querySelector<HTMLInputElement>('[data-config-name]')?.select()
}

function add(kind: RunKind): void {
  addOpen.value = false
  const cfg = newConfig(kind, newId(), t(`run.configs.newName.${kind}`), projects.value, props.root, run.templates)
  working.value.push(cfg)
  rows.value[cfg.id] = []
  selectedId.value = cfg.id
  void focusName()
}

function duplicate(): void {
  const c = current.value
  if (!c) return
  const copy = { ...cloneConfig(materialize(c)), id: newId(), name: t('run.configs.copyName', { name: c.name }) }
  working.value.splice(working.value.indexOf(c) + 1, 0, copy)
  rows.value[copy.id] = envRows(copy.env)
  selectedId.value = copy.id
  void focusName()
}

function remove(): void {
  const c = current.value
  if (!c) return
  const at = working.value.indexOf(c)
  working.value.splice(at, 1)
  delete rows.value[c.id]
  selectedId.value = working.value[Math.min(at, working.value.length - 1)]?.id ?? null
}

function setBefore(next: string[]): void {
  if (current.value) current.value.beforeLaunch = next
}

/** Saves what changed; false (and the offending config selected) when something is invalid or refused. */
async function apply(): Promise<boolean> {
  const list = working.value.map(materialize)
  const bad = list.find((c) => configIssues(c, rows.value[c.id] ?? []).length)
  if (bad) {
    selectedId.value = bad.id
    notice.value = { text: t('run.configs.saveFailed', { name: bad.name || '—' }), error: true }
    return false
  }
  const { save, remove: gone } = configChanges(original.value, list)
  if (!save.length && !gone.length) return true
  busy.value = true
  try {
    for (const id of gone) await run.deleteConfig(props.root, id)
    const failed: RunConfig[] = []
    for (const c of save) if (!(await run.saveConfig(props.root, c))) failed.push(c)
    const fresh = await run.loadConfigs(props.root)
    if (failed.length) {
      original.value = fresh.map(cloneConfig)
      selectedId.value = failed[0]!.id
      notice.value = { text: t('run.configs.saveFailed', { name: failed[0]!.name }), error: true }
      return false
    }
    reset(fresh, selectedId.value)
    notice.value = { text: t('run.configs.saved') }
    return true
  } finally {
    busy.value = false
  }
}

async function ok(): Promise<void> {
  if (await apply()) emit('close')
}

async function runSelected(): Promise<void> {
  const id = selectedId.value
  if (!id || !(await apply())) return
  run.select(props.root, { config: id })
  emit('close')
  await run.start(props.root)
}

async function importFrom(): Promise<void> {
  busy.value = true
  try {
    const found = await run.importConfigs(props.root)
    const fresh = await run.loadConfigs(props.root)
    const kept = working.value.filter((c) => fresh.some((f) => f.id === c.id) || !original.value.some((o) => o.id === c.id))
    const added = fresh.filter((f) => !kept.some((c) => c.id === f.id)).map(cloneConfig)
    original.value = fresh.map(cloneConfig)
    working.value = [...kept, ...added]
    for (const c of added) rows.value[c.id] = envRows(c.env)
    if (added[0]) selectedId.value = added[0].id
    notice.value = found.length ? { text: t('run.configs.imported', { n: found.length }, found.length) } : { text: t('run.configs.importNone') }
  } finally {
    busy.value = false
  }
}

function trap(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !sheet.value) return
  const items = [...sheet.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')].filter((n) => n.offsetParent)
  const at = items.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus()
}

function onEsc(): void {
  if (addOpen.value) addOpen.value = false
  else if (view.value === 'templates') view.value = 'configs'
  else emit('close')
}

const LABEL = 'pt-1.5 text-xs font-medium text-ink-muted'
const HINT = 'mt-1 text-2xs text-ink-faint'
const ICON_BTN =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-faint hover:bg-fill-strong hover:text-ink disabled:cursor-default disabled:text-ink-disabled disabled:hover:bg-transparent'
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[5vh] sm:px-4" @mousedown.self="emit('close')">
        <div
          ref="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-configs-title"
          class="ccm-sheet @container flex h-[min(86vh,720px)] w-full max-w-[880px] flex-col overflow-hidden"
          data-run-configs
          @keydown.esc.stop="onEsc"
          @keydown="trap"
        >
          <header class="flex items-center gap-2 border-b border-line px-4 py-3">
            <Settings2 :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 id="run-configs-title" class="min-w-0 flex-1 truncate text-sm font-semibold text-ink" :title="root">{{ t('run.configs.title') }}</h2>
            <button type="button" class="ccm-btn-plain shrink-0" :title="t('run.configs.close')" :aria-label="t('run.configs.close')" @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </header>

          <div class="flex min-h-0 flex-1 flex-col @2xl:flex-row">
            <aside class="flex max-h-48 shrink-0 flex-col border-b border-line @2xl:max-h-none @2xl:w-60 @2xl:border-r @2xl:border-b-0">
              <div class="relative flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
                <button
                  type="button"
                  :class="ICON_BTN"
                  :title="t('run.configs.add')"
                  :aria-label="t('run.configs.add')"
                  aria-haspopup="menu"
                  :aria-expanded="addOpen"
                  data-config-add
                  @click="addOpen = !addOpen"
                >
                  <Plus :size="15" aria-hidden="true" />
                </button>
                <button type="button" :class="ICON_BTN" :disabled="!current" :title="t('run.configs.duplicate')" :aria-label="t('run.configs.duplicate')" data-config-duplicate @click="duplicate">
                  <Copy :size="13" aria-hidden="true" />
                </button>
                <button type="button" :class="ICON_BTN" class="hover:text-st-error" :disabled="!current || current.id.startsWith('auto-')" :title="current?.id.startsWith('auto-') ? t('run.configs.autoNoRemove') : t('run.configs.remove')" :aria-label="t('run.configs.remove')" data-config-delete @click="remove">
                  <Trash2 :size="13" aria-hidden="true" />
                </button>
                <Transition name="ccm-menu">
                  <div v-if="addOpen" class="ccm-menu absolute top-full left-1.5 z-20 mt-1 flex w-52 flex-col p-1" style="--ccm-origin: top left" role="menu" :aria-label="t('run.configs.add')">
                    <button
                      v-for="kind in GROUPS"
                      :key="kind"
                      type="button"
                      role="menuitem"
                      class="flex h-8 w-full cursor-pointer items-center rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
                      :data-config-add-kind="kind"
                      @click="add(kind)"
                    >
                      {{ t(`run.configs.addKind.${kind}`) }}
                    </button>
                  </div>
                </Transition>
              </div>
              <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto p-1.5" role="list" :aria-label="t('run.configs.list')">
                <p v-if="loading" class="flex items-center gap-2 px-2 py-3 text-xs text-ink-muted"><LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('run.empty.detecting') }}</p>
                <p v-else-if="!working.length" class="px-2 py-3 text-xs text-ink-faint">{{ t('run.configs.empty') }}</p>
                <template v-for="g in grouped" :key="g.kind">
                  <p class="px-2 pt-1.5 pb-1 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t(`run.config.group.${g.kind}`) }}</p>
                  <button
                    v-for="c in g.items"
                    :key="c.id"
                    type="button"
                    role="listitem"
                    class="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm transition-colors duration-(--ccm-dur-fast)"
                    :class="c.id === selectedId ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
                    :aria-current="c.id === selectedId ? 'true' : undefined"
                    :title="c.cwd"
                    data-config-row
                    :data-config="c.name"
                    @click="selectedId = c.id"
                  >
                    <span class="min-w-0 flex-1 truncate" :class="c.id === selectedId ? 'font-medium' : ''">{{ c.name || '—' }}</span>
                    <span v-if="isDirty(c)" class="shrink-0 text-2xs text-ink-faint">{{ t('run.configs.modified') }}</span>
                  </button>
                </template>
              </div>
              <button type="button" class="ccm-btn-plain m-1.5 min-w-0 justify-start text-xs text-link" :aria-pressed="view === 'templates'" data-config-templates @click="openTemplates">
                <LayoutTemplate :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ t('run.templates.open') }}</span>
              </button>
            </aside>

            <section v-if="view === 'templates'" class="ccm-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-4" aria-labelledby="run-templates-title" data-config-templates-view>
              <div class="flex min-w-0 items-center gap-2">
                <button type="button" :class="ICON_BTN" :title="t('run.templates.back')" :aria-label="t('run.templates.back')" data-template-back @click="view = 'configs'">
                  <ArrowLeft :size="14" aria-hidden="true" />
                </button>
                <h3 id="run-templates-title" class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{{ t('run.templates.title') }}</h3>
              </div>
              <p class="text-2xs leading-relaxed text-ink-faint">{{ t('run.templates.hint') }}</p>
              <p class="text-xs font-semibold text-ink-muted">{{ t('run.templates.flutter') }}</p>
              <div class="grid grid-cols-1 gap-x-3 gap-y-3 @lg:grid-cols-[9rem_minmax(0,1fr)]">
                <span :class="LABEL">{{ t('run.configs.mode') }}</span>
                <div class="min-w-0"><SegmentedControl v-model="tpl.flutter.mode" :options="modeOptions" :label="t('run.configs.mode')" /></div>
                <label :class="LABEL" for="rt-flavor">{{ t('run.configs.flavor') }}</label>
                <div class="min-w-0">
                  <input id="rt-flavor" v-model.trim="tpl.flutter.flavor" type="text" maxlength="64" class="ccm-field h-8 w-full font-mono text-xs" spellcheck="false" data-template-flavor />
                  <p :class="HINT">{{ t('run.templates.flavorHint') }}</p>
                </div>
                <label :class="LABEL" for="rt-args">{{ t('run.configs.args') }}</label>
                <input id="rt-args" v-model="tpl.flutter.args" type="text" maxlength="2000" class="ccm-field h-8 min-w-0 font-mono text-xs" spellcheck="false" data-template-args />
              </div>
              <p class="border-t border-line pt-3 text-xs font-semibold text-ink-muted">{{ t('run.templates.android') }}</p>
              <div class="grid grid-cols-1 gap-x-3 gap-y-3 @lg:grid-cols-[9rem_minmax(0,1fr)]">
                <label :class="LABEL" for="rt-variant">{{ t('run.configs.variant') }}</label>
                <div class="min-w-0">
                  <input id="rt-variant" v-model.trim="tpl.android.variant" type="text" maxlength="64" class="ccm-field h-8 w-full font-mono text-xs" spellcheck="false" />
                  <p :class="HINT">{{ t('run.configs.variantHint') }}</p>
                </div>
                <label :class="LABEL" for="rt-gradle">{{ t('run.configs.gradleArgs') }}</label>
                <input id="rt-gradle" v-model="tpl.android.args" type="text" maxlength="2000" class="ccm-field h-8 min-w-0 font-mono text-xs" spellcheck="false" />
              </div>
              <p v-if="!tplValid" class="flex items-start gap-1.5 text-xs text-st-error" role="alert"><CircleAlert :size="13" class="mt-px shrink-0" aria-hidden="true" />{{ t('run.configs.invalid.variant') }}</p>
              <div class="flex min-w-0 items-center gap-2">
                <p v-if="tplNotice" class="min-w-0 flex-1 truncate text-xs" :class="tplNotice.error ? 'text-st-error' : 'text-success'" role="status">{{ tplNotice.text }}</p>
                <span v-else class="flex-1" />
                <button type="button" class="ccm-btn ccm-btn-primary shrink-0" :disabled="busy || !tplValid" data-template-save @click="saveTemplates">{{ t('run.templates.save') }}</button>
              </div>
            </section>

            <section v-else class="ccm-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
              <p v-if="!current" class="m-auto max-w-xs px-6 text-center text-xs text-ink-muted">{{ t('run.configs.noSelection') }}</p>
              <form v-else class="flex flex-col gap-3 p-4" @submit.prevent="ok">
                <div class="grid grid-cols-1 gap-x-3 gap-y-3 @lg:grid-cols-[9rem_minmax(0,1fr)]">
                  <label :class="LABEL" for="rc-name">{{ t('run.configs.name') }}</label>
                  <input id="rc-name" v-model="current.name" type="text" maxlength="80" class="ccm-field h-8 min-w-0 text-sm" data-config-name />

                  <label :class="LABEL" for="rc-cwd">{{ t('run.configs.project') }}</label>
                  <select id="rc-cwd" v-model="current.cwd" class="ccm-field h-8 min-w-0 cursor-pointer text-sm" :title="current.cwd">
                    <option v-for="d in projectDirs" :key="d" :value="d">{{ rel(d) }}</option>
                  </select>

                  <template v-if="current.type === 'flutter'">
                    <label :class="LABEL" for="rc-entry">{{ t('run.configs.entrypoint') }}</label>
                    <select id="rc-entry" v-model="current.entrypoint" class="ccm-field h-8 min-w-0 cursor-pointer font-mono text-xs">
                      <option v-for="e in entrypoints" :key="e" :value="e">{{ e }}</option>
                    </select>
                  </template>

                  <template v-if="current.type === 'android'">
                    <label :class="LABEL" for="rc-module">{{ t('run.configs.module') }}</label>
                    <select id="rc-module" v-model="current.module" class="ccm-field h-8 min-w-0 cursor-pointer font-mono text-xs">
                      <option v-for="m in modules" :key="m" :value="m">{{ m }}</option>
                    </select>
                    <label :class="LABEL" for="rc-variant">{{ t('run.configs.variant') }}</label>
                    <div class="min-w-0">
                      <input id="rc-variant" v-model.trim="current.variant" type="text" maxlength="64" class="ccm-field h-8 w-full font-mono text-xs" spellcheck="false" />
                      <p :class="HINT">{{ t('run.configs.variantHint') }}</p>
                    </div>
                  </template>

                  <template v-if="current.type !== 'custom'">
                    <label :class="LABEL" for="rc-device">{{ t('run.configs.device') }}</label>
                    <select id="rc-device" v-model="current.device" class="ccm-field h-8 min-w-0 cursor-pointer text-sm">
                      <option value="selected">{{ t('run.configs.deviceSelected') }}</option>
                      <option v-if="pinnedMissing" :value="pinnedMissing">{{ pinnedMissing }} · {{ t('run.device.offline') }}</option>
                      <option v-for="d in devices" :key="`${d.source}:${d.id}`" :value="d.id">{{ d.name }}</option>
                    </select>
                  </template>

                  <template v-if="current.type === 'flutter'">
                    <span :class="LABEL">{{ t('run.configs.mode') }}</span>
                    <div class="min-w-0">
                      <SegmentedControl v-model="current.mode" :options="modeOptions" :label="t('run.configs.mode')" />
                    </div>
                    <label :class="LABEL" for="rc-flavor">{{ t('run.configs.flavor') }}</label>
                    <div class="min-w-0">
                      <input id="rc-flavor" v-model.trim="current.flavor" type="text" maxlength="64" list="rc-flavors" class="ccm-field h-8 w-full font-mono text-xs" spellcheck="false" />
                      <datalist id="rc-flavors">
                        <option v-for="f in flavors" :key="f" :value="f" />
                      </datalist>
                      <p :class="HINT">{{ flavors.length ? t('run.configs.flavorHint', { list: flavors.join(', ') }) : t('run.configs.flavorNone') }}</p>
                    </div>
                  </template>

                  <template v-if="current.type === 'custom'">
                    <label :class="LABEL" for="rc-command">{{ t('run.configs.command') }}</label>
                    <div class="min-w-0">
                      <input id="rc-command" v-model="current.command" type="text" maxlength="2000" class="ccm-field h-8 w-full font-mono text-xs" spellcheck="false" />
                      <p :class="HINT">{{ t('run.configs.commandHint') }}</p>
                    </div>
                  </template>
                  <template v-else>
                    <label :class="LABEL" for="rc-args">{{ current.type === 'android' ? t('run.configs.gradleArgs') : t('run.configs.args') }}</label>
                    <div class="min-w-0">
                      <input id="rc-args" v-model="current.args" type="text" maxlength="2000" class="ccm-field h-8 w-full font-mono text-xs" spellcheck="false" />
                      <p v-if="current.type === 'flutter'" :class="HINT">{{ t('run.configs.argsHint') }}</p>
                    </div>
                  </template>

                  <template v-if="current.type === 'flutter'">
                    <label :class="LABEL" for="rc-attach">{{ t('run.configs.attachArgs') }}</label>
                    <div class="min-w-0">
                      <input id="rc-attach" v-model="current.attachArgs" type="text" maxlength="2000" class="ccm-field h-8 w-full font-mono text-xs" spellcheck="false" />
                      <p :class="HINT">{{ t('run.configs.attachHint') }}</p>
                    </div>
                  </template>

                  <span :class="LABEL">{{ t('run.configs.env') }}</span>
                  <div class="flex min-w-0 flex-col gap-1.5" role="group" :aria-label="t('run.configs.env')">
                    <p v-if="!currentRows.length" class="pt-1.5 text-2xs text-ink-faint">{{ t('run.configs.envEmpty') }}</p>
                    <div v-for="(r, i) in currentRows" :key="i" class="flex min-w-0 items-center gap-1.5" data-config-env>
                      <input v-model="r.key" type="text" maxlength="128" class="ccm-field h-7 w-36 min-w-0 shrink font-mono text-2xs" :placeholder="t('run.configs.envKey')" :aria-label="t('run.configs.envKey')" spellcheck="false" />
                      <input v-model="r.value" type="text" maxlength="4096" class="ccm-field h-7 min-w-0 flex-1 font-mono text-2xs" :placeholder="t('run.configs.envValue')" :aria-label="t('run.configs.envValue')" spellcheck="false" />
                      <button type="button" :class="ICON_BTN" :title="t('run.configs.envRemove', { name: r.key })" :aria-label="t('run.configs.envRemove', { name: r.key })" @click="currentRows.splice(i, 1)">
                        <X :size="13" aria-hidden="true" />
                      </button>
                    </div>
                    <button type="button" class="ccm-btn-plain self-start text-xs text-link" data-config-env-add @click="currentRows.push({ key: '', value: '' })">
                      <Plus :size="13" aria-hidden="true" />{{ t('run.configs.envAdd') }}
                    </button>
                  </div>

                  <span :class="LABEL">{{ t('run.configs.before') }}</span>
                  <div class="flex min-w-0 flex-col gap-1.5" role="group" :aria-label="t('run.configs.before')">
                    <p class="pt-1.5 text-2xs text-ink-faint">{{ current.beforeLaunch.length ? t('run.configs.beforeHint') : t('run.configs.beforeEmpty') }}</p>
                    <ol class="flex flex-col gap-1.5">
                      <li v-for="(step, i) in current.beforeLaunch" :key="i" class="flex min-w-0 items-center gap-1" data-config-before>
                        <span class="w-5 shrink-0 text-right text-2xs text-ink-faint tabular" aria-hidden="true">{{ i + 1 }}</span>
                        <input
                          :value="step"
                          type="text"
                          maxlength="500"
                          class="ccm-field h-7 min-w-0 flex-1 font-mono text-2xs"
                          :aria-label="t('run.configs.beforeStep', { n: i + 1 })"
                          spellcheck="false"
                          @input="current.beforeLaunch[i] = ($event.target as HTMLInputElement).value"
                        />
                        <button type="button" :class="ICON_BTN" :disabled="i === 0" :title="t('run.configs.moveUp', { n: i + 1 })" :aria-label="t('run.configs.moveUp', { n: i + 1 })" @click="setBefore(moveItem(current.beforeLaunch, i, -1))">
                          <ArrowUp :size="13" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          :class="ICON_BTN"
                          :disabled="i === current.beforeLaunch.length - 1"
                          :title="t('run.configs.moveDown', { n: i + 1 })"
                          :aria-label="t('run.configs.moveDown', { n: i + 1 })"
                          @click="setBefore(moveItem(current.beforeLaunch, i, 1))"
                        >
                          <ArrowDown :size="13" aria-hidden="true" />
                        </button>
                        <button type="button" :class="ICON_BTN" :title="t('run.configs.beforeRemove', { n: i + 1 })" :aria-label="t('run.configs.beforeRemove', { n: i + 1 })" @click="current.beforeLaunch.splice(i, 1)">
                          <X :size="13" aria-hidden="true" />
                        </button>
                      </li>
                    </ol>
                    <button
                      type="button"
                      class="ccm-btn-plain self-start text-xs text-link"
                      :disabled="current.beforeLaunch.length >= 10"
                      data-config-before-add
                      @click="current.beforeLaunch.push('')"
                    >
                      <Plus :size="13" aria-hidden="true" />{{ t('run.configs.beforeAdd') }}
                    </button>
                  </div>
                </div>

                <ToggleSwitch v-model="current.shared" :label="t('run.configs.shared')" :hint="t('run.configs.sharedHint', { id: current.id })" class="border-t border-line pt-3" />

                <ul v-if="issues.length" class="flex flex-col gap-1 text-xs text-st-error" role="alert">
                  <li v-for="(i, n) in issues" :key="n" class="flex items-start gap-1.5"><CircleAlert :size="13" class="mt-px shrink-0" aria-hidden="true" />{{ issueText(i) }}</li>
                </ul>
              </form>
            </section>
          </div>

          <div v-if="current && view === 'configs'" class="shrink-0 border-t border-line bg-well px-4 py-2.5" data-config-preview>
            <p class="mb-1 flex items-center gap-1.5 text-2xs font-medium text-(--ccm-ansi-8)">
              {{ t('run.configs.preview') }}<LoaderCircle v-if="previewing" :size="11" class="ccm-spin" aria-hidden="true" />
            </p>
            <p class="font-mono text-2xs break-all whitespace-pre-wrap text-well-ink" aria-live="polite">{{ preview?.command || t('run.configs.previewEmpty') }}</p>
            <p v-for="(e, i) in previewErrors" :key="i" class="mt-1 flex items-start gap-1.5 text-2xs text-(--ccm-ansi-9)" role="alert">
              <CircleAlert :size="12" class="mt-px shrink-0" aria-hidden="true" />{{ e }}
            </p>
          </div>

          <footer class="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <button type="button" class="ccm-btn-plain min-w-0 text-xs" :disabled="busy" data-config-import @click="importFrom">
              <Download :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ t('run.configs.import') }}</span>
            </button>
            <p v-if="notice" class="min-w-0 flex-1 truncate text-xs" :class="notice.error ? 'text-st-error' : 'text-success'" role="status" :title="notice.text">{{ notice.text }}</p>
            <span v-else class="flex-1" />
            <button type="button" class="ccm-btn" :disabled="busy || !current" data-config-run @click="runSelected">{{ t('run.configs.run') }}</button>
            <button type="button" class="ccm-btn" @click="emit('close')">{{ t('run.configs.cancel') }}</button>
            <button type="button" class="ccm-btn" :disabled="busy" data-config-apply @click="apply">{{ t('run.configs.apply') }}</button>
            <button type="button" class="ccm-btn ccm-btn-primary" :disabled="busy" data-config-ok @click="ok">{{ t('run.configs.ok') }}</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
