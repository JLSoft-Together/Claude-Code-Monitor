<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, CircleX, Info, LoaderCircle, Moon, Ruler, Sun, TriangleAlert, ZoomIn } from 'lucide-vue-next'
import AppSelect, { type SelectOption } from '../AppSelect.vue'
import SegmentedControl, { type Segment } from '../ui/SegmentedControl.vue'
import { layoutDownload, layoutStatus, layoutWarmup, onLayoutEvent, type LayoutDiagnostic, type LayoutStatus } from '../../lib/layoutPreview'
import {
  DRAWABLE_DPI,
  DRAWABLE_SIZES,
  DRAWABLE_STATES,
  DRAWABLE_ZOOMS,
  cssColor,
  currentSwatch,
  drawableRender,
  drawableScale,
  type DrawableRenderResult,
} from '../../lib/drawablePreview'

const props = withDefaults(defineProps<{ path: string; revision: number; text?: string | null }>(), { text: null })
const { t, te } = useI18n()

const OPTIONS_KEY = 'ccm.drawable.options'
const CUSTOM = '__custom'

interface Options {
  size: number
  night: boolean
  states: string[]
  zoom: 'fit' | number
}

const validSize = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 1024

function loadOptions(): Options {
  const base: Options = { size: 48, night: false, states: [], zoom: 'fit' }
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? 'null') as Partial<Options> | null
    if (!raw) return base
    return {
      size: validSize(raw.size) ? raw.size : base.size,
      night: raw.night === true,
      states: Array.isArray(raw.states) ? raw.states.filter((s) => (DRAWABLE_STATES as readonly string[]).includes(s)) : [],
      zoom: raw.zoom === 'fit' || (DRAWABLE_ZOOMS as readonly number[]).includes(raw.zoom as number) ? raw.zoom! : 'fit',
    }
  } catch {
    return base
  }
}

const opts = ref<Options>(loadOptions())
watch(
  opts,
  (o) => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(o))
    } catch {
      // storage off
    }
  },
  { deep: true },
)

const status = ref<LayoutStatus | null>(null)
const statusLoaded = ref(false)
const downloading = ref(false)
const rendering = ref(false)
const result = shallowRef<DrawableRenderResult | null>(null)
const canvas = ref<HTMLElement | null>(null)
const box = ref({ width: 0, height: 0 })

const ready = computed(() => !!status.value && status.value.jar && status.value.jdk.ok && status.value.bundle.state === 'ready')
const ok = computed(() => (result.value?.ok ? result.value : null))
const diagnostics = computed<LayoutDiagnostic[]>(() => ok.value?.diagnostics ?? [])
const scale = computed(() => (ok.value ? drawableScale(ok.value.width, ok.value.height, box.value.width - 32, box.value.height - 32, opts.value.zoom) : 1))
const stage = computed(() => (ok.value ? { width: Math.round(ok.value.width * scale.value), height: Math.round(ok.value.height * scale.value) } : { width: 0, height: 0 }))
const activeSwatch = computed(() => currentSwatch(opts.value.states))

const isPreset = (n: number): boolean => (DRAWABLE_SIZES as readonly number[]).includes(n)
const customSize = ref(isPreset(opts.value.size) ? '' : String(opts.value.size))
const sizeChoice = ref(isPreset(opts.value.size) ? String(opts.value.size) : CUSTOM)
const sizeOptions = computed<SelectOption<string>[]>(() => [
  ...DRAWABLE_SIZES.map((n) => ({ value: String(n), label: t('layout.drawable.size.preset', { n }) })),
  { value: CUSTOM, label: customSize.value ? t('layout.drawable.size.customValue', { n: customSize.value }) : t('layout.drawable.size.custom') },
])
watch(sizeChoice, (v) => {
  if (v !== CUSTOM) opts.value.size = Number(v)
})
function applyCustomSize(): void {
  const n = Number(customSize.value.trim())
  if (validSize(n)) opts.value.size = n
}

const zoomOptions = computed<SelectOption<string>[]>(() => [
  { value: 'fit', label: t('layout.drawable.zoom.fit') },
  ...DRAWABLE_ZOOMS.map((n) => ({ value: String(n), label: t('layout.drawable.zoom.percent', { n }) })),
])
const zoomValue = computed({
  get: () => String(opts.value.zoom),
  set: (v: string) => (opts.value.zoom = v === 'fit' ? 'fit' : Number(v)),
})
const themeOptions = computed<Segment<'light' | 'dark'>[]>(() => [
  { value: 'light', label: t('layout.theme.light'), icon: Sun },
  { value: 'dark', label: t('layout.theme.dark'), icon: Moon },
])
const themeValue = computed({
  get: () => (opts.value.night ? 'dark' : 'light') as 'light' | 'dark',
  set: (v: 'light' | 'dark') => (opts.value.night = v === 'dark'),
})

function toggleState(s: string): void {
  const cur = opts.value.states
  opts.value.states = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]
}

const errorText = computed(() => {
  const r = result.value
  if (!r || r.ok) return ''
  return te(`layout.error.${r.code}`) ? t(`layout.error.${r.code}`) : t('layout.error.other', { code: r.code })
})

let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

function schedule(ms = 200): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void render()
  }, ms)
}

async function render(): Promise<void> {
  if (!ready.value) return
  const my = ++seq
  rendering.value = true
  const res = await drawableRender({ file: props.path, width: opts.value.size, height: opts.value.size, density: DRAWABLE_DPI, night: opts.value.night, states: [...opts.value.states], ...(props.text === null ? {} : { text: props.text }) })
  if (my !== seq) return
  rendering.value = false
  if (!res.ok && res.code === 'cancelled') return
  result.value = res
}

async function refreshStatus(): Promise<void> {
  status.value = await layoutStatus()
  statusLoaded.value = true
  if (ready.value) schedule(0)
}

async function download(): Promise<void> {
  downloading.value = true
  await layoutDownload()
  downloading.value = false
  await refreshStatus()
}

const offEvent = onLayoutEvent((e) => {
  if (e.type === 'bundle' && e.status.state === 'ready') void refreshStatus()
  else if (e.type === 'project-changed') schedule(300)
})

// Editor text is already debounced by FilePane; disk changes still coalesce a little.
watch(() => props.revision, () => schedule(props.text !== null ? 0 : 120))
watch(
  () => props.path,
  () => {
    result.value = null
    schedule(0)
  },
)
watch([() => opts.value.size, () => opts.value.night, () => opts.value.states], () => schedule(100), { deep: true })

const SEVERITY = {
  error: { icon: CircleX, cls: 'text-st-error' },
  warning: { icon: TriangleAlert, cls: 'text-warning' },
  info: { icon: Info, cls: 'text-well-ink' },
} as const

const resize = new ResizeObserver(([entry]) => {
  if (entry) box.value = { width: entry.contentRect.width, height: entry.contentRect.height }
})

onMounted(() => {
  if (canvas.value) resize.observe(canvas.value)
  void layoutWarmup(props.path)
  void refreshStatus()
})

onBeforeUnmount(() => {
  resize.disconnect()
  offEvent()
  if (timer) clearTimeout(timer)
  seq++
})
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-well text-well-ink" :aria-label="t('layout.drawable.region')" data-drawable-preview>
    <div class="ccm-material flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1" role="toolbar" :aria-label="t('layout.drawable.toolbar')">
      <AppSelect v-model="sizeChoice" :options="sizeOptions" :label="t('layout.drawable.size.label')" :icon="Ruler" size="sm" data-drawable-size />
      <input
        v-if="sizeChoice === CUSTOM"
        v-model="customSize"
        type="number"
        min="1"
        max="1024"
        class="ccm-field h-6 w-16 shrink-0 text-2xs tabular"
        :placeholder="t('layout.drawable.size.customLabel')"
        :aria-label="t('layout.drawable.size.customLabel')"
        :title="t('layout.drawable.size.customLabel')"
        @keydown.enter="applyCustomSize"
        @blur="applyCustomSize"
      />
      <SegmentedControl v-model="themeValue" :options="themeOptions" :label="t('layout.theme.label')" icon-only />
      <div class="flex min-w-0 flex-wrap items-center gap-1" role="group" :aria-label="t('layout.drawable.states.label')" data-drawable-states>
        <button
          v-for="s in DRAWABLE_STATES"
          :key="s"
          type="button"
          class="h-6 shrink-0 rounded-full border px-2 text-2xs transition-colors duration-(--ccm-dur-fast)"
          :class="opts.states.includes(s) ? 'border-accent bg-accent text-on-accent' : 'border-line hover:bg-well-line'"
          :aria-pressed="opts.states.includes(s)"
          @click="toggleState(s)"
        >
          {{ t(`layout.drawable.states.${s}`) }}
        </button>
      </div>
      <span class="flex-1" />
      <AppSelect v-model="zoomValue" :options="zoomOptions" :label="t('layout.drawable.zoom.label')" :icon="ZoomIn" size="sm" />
    </div>

    <p v-if="ok?.frameworkOnly && diagnostics.some((d) => d.severity !== 'info')" class="flex shrink-0 items-start gap-2 border-b border-well-line px-3 py-1.5 text-xs" role="note">
      <Info :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ t('layout.drawable.framework') }}</span>
    </p>

    <div ref="canvas" class="ccm-scroll relative min-h-0 flex-1 overflow-auto">
      <div v-if="!statusLoaded" class="grid size-full place-items-center p-6 text-xs">
        <span class="flex items-center gap-2"><LoaderCircle :size="14" class="ccm-spin" aria-hidden="true" />{{ t('layout.setup.checking') }}</span>
      </div>
      <div v-else-if="!ready" class="grid size-full place-items-center p-6">
        <div class="flex max-w-sm flex-col items-center gap-2 text-center text-sm">
          <p class="flex items-start gap-2"><CircleAlert :size="16" class="mt-0.5 shrink-0 text-st-error" aria-hidden="true" />{{ !status?.jar ? t('layout.setup.jarMissing') : !status.jdk.ok ? t('layout.setup.jdkMissing') : t('layout.drawable.setup') }}</p>
          <button v-if="status?.jar && status.jdk.ok" type="button" class="ccm-btn-primary" :disabled="downloading" @click="download">{{ t('layout.setup.download') }}</button>
        </div>
      </div>
      <div v-else-if="ok && ok.kind === 'color'" class="flex min-h-full flex-wrap content-center justify-center gap-3 p-4" role="list" :aria-label="t('layout.drawable.swatches')" data-drawable-swatches>
        <figure
          v-for="s in ok.swatches ?? []"
          :key="s.state"
          class="flex w-24 flex-col items-center gap-1"
          role="listitem"
          :aria-current="s.state === activeSwatch ? 'true' : undefined"
          :title="s.state === activeSwatch ? t('layout.drawable.current') : undefined"
        >
          <div class="ccm-checker size-16 overflow-hidden rounded-inner ring-1" :class="s.state === activeSwatch ? 'ring-2 ring-accent' : 'ring-well-line'">
            <div class="size-full" :style="{ background: cssColor(s.color) }" />
          </div>
          <figcaption class="flex w-full min-w-0 flex-col items-center text-2xs">
            <span class="w-full truncate text-center">{{ te(`layout.drawable.swatch.${s.state}`) ? t(`layout.drawable.swatch.${s.state}`) : s.state }}</span>
            <span class="ccm-code tabular">{{ s.color }}</span>
          </figcaption>
        </figure>
      </div>
      <div v-else class="grid min-h-full min-w-full place-items-center p-4">
        <div
          v-if="ok?.pngUrl"
          class="ccm-checker relative shrink-0 ring-1 ring-well-line"
          :style="{ width: `${stage.width}px`, height: `${stage.height}px` }"
          data-drawable-stage
        >
          <img :src="ok.pngUrl" :alt="t('layout.drawable.image')" class="pointer-events-none block size-full select-none [image-rendering:pixelated]" draggable="false" />
        </div>
        <p v-else-if="ok" class="text-xs">{{ t('layout.noImage') }}</p>
      </div>
    </div>

    <div v-if="ready && diagnostics.length" class="ccm-scroll max-h-[30%] shrink-0 overflow-auto border-t border-well-line" data-drawable-diagnostics>
      <h3 class="px-3 pt-1.5 text-2xs font-semibold">{{ t('layout.diagnostics.title', { n: diagnostics.length }) }}</h3>
      <ul class="py-1">
        <li v-for="(d, i) in diagnostics" :key="i" class="flex items-start gap-2 px-3 py-1 text-xs">
          <component :is="SEVERITY[d.severity].icon" :size="13" class="mt-0.5 shrink-0" :class="SEVERITY[d.severity].cls" aria-hidden="true" />
          <span class="min-w-0 flex-1 break-words">{{ d.message }}</span>
          <span v-if="d.line" class="shrink-0 text-2xs tabular">{{ t('layout.diagnostics.line', { line: d.line }) }}</span>
        </li>
      </ul>
    </div>

    <p v-if="ready" class="flex h-7 shrink-0 items-center gap-1.5 border-t border-well-line px-3 text-2xs" role="status" aria-live="polite" data-drawable-status>
      <template v-if="rendering">
        <LoaderCircle :size="13" class="ccm-spin shrink-0" aria-hidden="true" />{{ t('layout.status.rendering') }}
      </template>
      <template v-else-if="result && !result.ok">
        <CircleAlert :size="13" class="shrink-0 text-st-error" aria-hidden="true" />
        <span class="truncate" :title="result.detail || errorText">{{ t('layout.status.error') }} · {{ errorText }}</span>
      </template>
      <template v-else-if="ok">
        <CircleCheck :size="13" class="shrink-0 text-success" aria-hidden="true" />
        <span class="tabular">{{ t('layout.drawable.kind.' + ok.kind) }} · {{ t('layout.status.done', { ms: ok.renderMs }) }}</span>
        <span v-if="ok.sourceOnly" class="truncate" :title="t('layout.model.sourceHint')" data-drawable-source>· {{ t('layout.model.source') }}</span>
      </template>
    </p>
  </section>
</template>

<style scoped>
.ccm-checker {
  background-color: var(--color-well);
  background-image: conic-gradient(var(--color-well-line) 25%, transparent 0 50%, var(--color-well-line) 0 75%, transparent 0);
  background-size: 16px 16px;
}
</style>
