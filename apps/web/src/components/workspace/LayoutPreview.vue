<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, CircleX, Coffee, Columns3, Download, Frame, Hammer, Info, LoaderCircle, Moon, Palette, RefreshCw, RotateCcw, Smartphone, Sun, TriangleAlert, ZoomIn } from 'lucide-vue-next'
import AppSelect, { type SelectOption } from '../AppSelect.vue'
import SegmentedControl, { type Segment } from '../ui/SegmentedControl.vue'
import LayoutBoxes from './LayoutBoxes.vue'
import { desktop } from '../../lib/desktop'
import { isMac } from '../../lib/platform'
import { keyCombo } from '../../lib/shortcuts'
import {
  DENSITIES,
  DEVICE_PRESETS,
  DPI_MAX,
  DPI_MIN,
  LOCALES,
  THEME_AUTO,
  THEME_DAYNIGHT,
  BLUEPRINT_MAX,
  ZOOMS,
  compareCellAt,
  compareConfigs,
  deviceFor,
  dpSize,
  fitScale,
  flattenTree,
  hitTest,
  layoutDownload,
  layoutRender,
  layoutWarmup,
  layoutModelPick,
  layoutModelRefresh,
  layoutModelStatus,
  borrowedModel,
  layoutStatus,
  modelChip,
  needsModelNotice,
  nodeForLine,
  onLayoutEvent,
  renderScale,
  INIT_STAGE_PROGRESS,
  shortClass,
  stepView,
  validDpi,
  withDensity,
  type CompareConfig,
  type InitStage,
  type LayoutDiagnostic,
  type LayoutModelInfo,
  type LayoutRenderResult,
  type LayoutStatus,
  type LayoutViewNode,
} from '../../lib/layoutPreview'

const props = withDefaults(defineProps<{ path: string; revision: number; line?: number | null; active?: boolean; text?: string | null }>(), { line: null, active: true, text: null })
const emit = defineEmits<{ reveal: [line: number, select: boolean] }>()
const { t, te, locale: uiLocale } = useI18n()

const OPTIONS_KEY = 'ccm.layout.options'
const CUSTOM = '__custom'

interface Options {
  device: string
  landscape: boolean
  night: boolean
  locale: string
  zoom: 'fit' | number
  blueprint: boolean
  /** '' = project theme (daemon resolves tools:context → app theme). */
  theme: string
  compare: boolean
  /** dpi override; 0 = the device preset's own density. */
  density: number
}

function loadOptions(): Options {
  const base: Options = { device: 'pixel5', landscape: false, night: false, locale: '', zoom: 'fit', blueprint: false, theme: THEME_AUTO, compare: false, density: 0 }
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? 'null') as Partial<Options> | null
    if (!raw) return base
    return {
      device: DEVICE_PRESETS.some((d) => d.id === raw.device) ? raw.device! : base.device,
      landscape: raw.landscape === true,
      night: raw.night === true,
      locale: typeof raw.locale === 'string' && /^[A-Za-z0-9+_-]{0,35}$/.test(raw.locale) ? raw.locale : '',
      zoom: raw.zoom === 'fit' || ZOOMS.includes(raw.zoom as (typeof ZOOMS)[number]) ? raw.zoom! : 'fit',
      blueprint: raw.blueprint === true,
      theme: typeof raw.theme === 'string' && /^[@A-Za-z0-9_.:/]{0,128}$/.test(raw.theme) ? raw.theme : THEME_AUTO,
      compare: raw.compare === true,
      density: validDpi(raw.density) ? raw.density : 0,
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
const downloadPct = ref<number | null>(null)
const rendering = ref(false)
const daemonStarting = ref(false)
const error = ref<{ code: string; detail?: string } | null>(null)
const pngUrl = ref<string | null>(null)
const size = ref({ width: 0, height: 0 })
const tree = shallowRef<LayoutViewNode | null>(null)
const diagnostics = shallowRef<LayoutDiagnostic[]>([])
const renderMs = ref<number | null>(null)
const cached = ref(false)
const frameworkOnly = ref(false)
const builtinLibs = ref(false)
const sourceOnly = ref(false)
const prebuiltAt = ref<number | null>(null)
const shots = shallowRef<{ cfg: CompareConfig; res: LayoutRenderResult }[]>([])
const model = ref<LayoutModelInfo | null>(null)
const modelBusy = ref(false)
const hovered = shallowRef<LayoutViewNode | null>(null)
const selected = shallowRef<LayoutViewNode | null>(null)
const customLocale = ref(LOCALES.includes(opts.value.locale as (typeof LOCALES)[number]) || !opts.value.locale ? '' : opts.value.locale)
const localeChoice = ref(customLocale.value ? CUSTOM : opts.value.locale)

const canvas = ref<HTMLElement | null>(null)
const box = ref({ width: 0, height: 0 })
// v46 smoothness: the frame being replaced fades out under the new one; waits get staged, delayed indicators.
const prevUrl = ref<string | null>(null)
const staleFrame = ref(false)
const frameSeq = ref(0)
const shownScale = ref(1)
const initStage = ref<InitStage | null>(null)
const libsLoading = ref<'kit' | 'project' | null>(null)
const busy = ref(false)
let busyTimer: ReturnType<typeof setTimeout> | null = null
let prevTimer: ReturnType<typeof setTimeout> | null = null
const BUSY_DELAY_MS = 150
const CROSSFADE_MS = 160
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const ready = computed(() => !!status.value && status.value.jar && status.value.jdk.ok && status.value.bundle.state === 'ready')
const device = computed(() => withDensity(deviceFor(opts.value.device, opts.value.landscape), opts.value.density))
const scale = computed(() => {
  const w = size.value.width || device.value.width
  const h = size.value.height || device.value.height
  return opts.value.zoom === 'fit' ? fitScale(w, h, box.value.width - 32, box.value.height - 32) : opts.value.zoom / 100
})
const dpr = (): number => (typeof window !== 'undefined' && window.devicePixelRatio) || 1
/** Image px per device px for the single stage: what is on screen, never more than the device. */
const wantScale = computed(() => {
  const d = device.value
  const view = opts.value.zoom === 'fit' ? fitScale(d.width, d.height, box.value.width - 32, box.value.height - 32) : opts.value.zoom / 100
  return box.value.width > 0 ? renderScale(view, dpr()) : 1
})
const starting = computed(() => status.value?.daemon === 'starting' || daemonStarting.value)
const waitTitle = computed(() => {
  if (starting.value) return t('layout.wait.starting')
  if (libsLoading.value) return t(libsLoading.value === 'kit' ? 'layout.wait.libraries' : 'layout.wait.project')
  if (chip.value.kind === 'running') return t('layout.wait.model')
  return t('layout.wait.rendering')
})
const waitDetail = computed(() => {
  if (starting.value) return t(`layout.wait.stage.${initStage.value ?? 'jvm'}`)
  if (libsLoading.value) return t(libsLoading.value === 'kit' ? 'layout.wait.librariesHint' : 'layout.wait.projectHint')
  return ''
})
const stageProgress = computed(() => INIT_STAGE_PROGRESS[initStage.value ?? 'jvm'])
const hasFrame = computed(() => !!pngUrl.value || tree.value !== null)
/** Nothing rendered yet for this file: the device-shaped skeleton and the staged wait card show. */
const awaitingFirst = computed(() => ready.value && !hasFrame.value && !error.value && (rendering.value || renderMs.value === null))

/** Decoded before it is shown, so the swap never paints a half-loaded or empty image. */
function decoded(url: string | null): Promise<void> {
  if (!url || typeof Image === 'undefined') return Promise.resolve()
  const img = new Image()
  img.src = url
  return img.decode().catch(() => undefined)
}

function showFrame(url: string | null): void {
  if (url === pngUrl.value) return
  if (prevTimer) clearTimeout(prevTimer)
  prevUrl.value = pngUrl.value && url && !reducedMotion() ? pngUrl.value : null
  pngUrl.value = url
  frameSeq.value++
  prevTimer = setTimeout(() => (prevUrl.value = null), CROSSFADE_MS + 40)
}

watch(rendering, (on) => {
  if (busyTimer) clearTimeout(busyTimer)
  busyTimer = null
  if (!on) busy.value = false
  else busyTimer = setTimeout(() => (busy.value = rendering.value), BUSY_DELAY_MS)
})

// Zoom: the stage jumps to its new size, then eases from the old scale (transform only, no layout per frame).
const zoomFlip = ref<number | null>(null)
watch(scale, (next, old) => {
  if (!old || !next || old === next || !hasFrame.value || reducedMotion()) return
  zoomFlip.value = old / next
  requestAnimationFrame(() => requestAnimationFrame(() => (zoomFlip.value = null)))
})
const stageMotion = computed(() =>
  zoomFlip.value === null ? { transform: '', transition: 'transform var(--ccm-dur-base) var(--ease-out-quint)' } : { transform: `scale(${zoomFlip.value})`, transition: 'none' },
)
// Zooming in past the pixels of the shown image: render sharper (the cached lower-res frame stays until then).
watch(wantScale, (s) => {
  if (ready.value && hasFrame.value && !opts.value.compare && s > shownScale.value) schedule(150)
})
const stage = computed(() => ({ width: Math.round((size.value.width || device.value.width) * scale.value), height: Math.round((size.value.height || device.value.height) * scale.value) }))
const nodes = computed(() => (opts.value.blueprint ? flattenTree(tree.value).slice(0, BLUEPRINT_MAX) : []))

const deviceOptions = computed<SelectOption<string>[]>(() =>
  DEVICE_PRESETS.map((d) => ({ value: d.id, label: t(`layout.device.${d.id}`), hint: t('layout.device.hint', dpSize(d)) })),
)
const localeOptions = computed<SelectOption<string>[]>(() => [
  { value: '', label: t('layout.locale.default') },
  ...LOCALES.map((l) => ({ value: l as string, label: l })),
  { value: CUSTOM, label: customLocale.value || t('layout.locale.custom') },
])
const zoomOptions = computed<SelectOption<string>[]>(() => [{ value: 'fit', label: t('layout.zoom.fit') }, ...ZOOMS.map((n) => ({ value: String(n), label: t('layout.zoom.percent', { n }) }))])
const zoomValue = computed({
  get: () => String(opts.value.zoom),
  set: (v: string) => (opts.value.zoom = v === 'fit' ? 'fit' : Number(v)),
})
const presetDpi = computed(() => deviceFor(opts.value.device, false).density)
const isPresetDensity = (n: number): boolean => n === 0 || DENSITIES.some((d) => d.dpi === n)
const customDpi = ref(isPresetDensity(opts.value.density) ? '' : String(opts.value.density))
const densityChoice = ref(isPresetDensity(opts.value.density) ? String(opts.value.density) : CUSTOM)
const densityOptions = computed<SelectOption<string>[]>(() => [
  { value: '0', label: t('layout.density.device', { dpi: presetDpi.value }) },
  ...DENSITIES.map((d) => ({ value: String(d.dpi), label: t('layout.density.preset', { name: d.id, dpi: d.dpi }) })),
  { value: CUSTOM, label: customDpi.value ? t('layout.density.customValue', { dpi: customDpi.value }) : t('layout.density.custom') },
])
watch(densityChoice, (v) => {
  if (v !== CUSTOM) opts.value.density = Number(v)
})
function applyCustomDpi(): void {
  const n = Number(customDpi.value.trim())
  if (validDpi(n)) opts.value.density = n
}

const themeOptions = computed<Segment<'light' | 'dark'>[]>(() => [
  { value: 'light', label: t('layout.theme.light'), icon: Sun },
  { value: 'dark', label: t('layout.theme.dark'), icon: Moon },
])
const themeValue = computed({
  get: () => (opts.value.night ? 'dark' : 'light') as 'light' | 'dark',
  set: (v: 'light' | 'dark') => (opts.value.night = v === 'dark'),
})

const appThemeOptions = computed<SelectOption<string>[]>(() => {
  const list: SelectOption<string>[] = [
    { value: THEME_AUTO, label: t('layout.themePick.auto') },
    { value: THEME_DAYNIGHT, label: t('layout.themePick.dayNight') },
  ]
  for (const th of model.value?.themes ?? []) list.push({ value: th, label: th.replace(/^@style\//, '') })
  if (opts.value.theme && !list.some((o) => o.value === opts.value.theme)) list.push({ value: opts.value.theme, label: opts.value.theme.replace(/^@style\//, '') })
  return list
})

const chip = computed(() => modelChip(model.value))
const borrowed = computed(() => borrowedModel(model.value))
const appOptions = computed<SelectOption<string>[]>(() => (borrowed.value?.choices ?? []).map((m) => ({ value: m, label: m })))
const appPick = computed({
  get: () => borrowed.value?.app ?? '',
  set: (module: string) => void pickApp(module),
})
const chipBase = computed(() => {
  const c = chip.value
  if (c.kind === 'ready') return t('layout.model.ready', { time: new Date(c.at ?? 0).toLocaleTimeString(uiLocale.value, { hour: '2-digit', minute: '2-digit' }) })
  if (c.kind === 'running') return t(model.value?.state.state === 'running' && model.value.state.compile ? 'layout.model.compiling' : 'layout.model.running')
  if (c.kind === 'error') return t('layout.model.error')
  if (prebuiltAt.value) return t('layout.model.prebuilt', { date: prebuiltDate.value })
  return t(sourceOnly.value ? 'layout.model.source' : builtinLibs.value ? 'layout.model.builtin' : 'layout.model.framework')
})
const chipText = computed(() => {
  const b = borrowed.value
  return b && !appOptions.value.length ? `${chipBase.value} · ${t('layout.model.via', { app: b.app })}` : chipBase.value
})
const chipTitle = computed(() => {
  const b = borrowed.value
  const why = b ? t(b.linked ? 'layout.model.borrowedHint' : 'layout.model.unlinkedHint', { library: b.library, app: b.app }) : ''
  return [why, chipState.value].filter(Boolean).join('\n')
})
const chipState = computed(() => {
  const m = model.value
  if (prebuiltAt.value && chip.value.kind === 'framework') return t('layout.model.prebuiltHint', { date: prebuiltDate.value })
  if (sourceOnly.value && chip.value.kind === 'framework') return t('layout.model.sourceHint')
  if (builtinLibs.value && chip.value.kind === 'framework') return t('layout.model.builtinHint')
  if (!m?.target) return m?.reason === 'no-app' ? t('layout.model.noApp') : m?.reason === 'no-gradle' ? t('layout.model.noGradle') : t('layout.model.frameworkHint')
  const s = m.state
  if (s.state === 'ready') return t('layout.model.readyHint', { module: m.target.module, res: s.resCount, cp: s.classpathCount })
  if (s.state === 'error') {
    const why = te(`layout.model.errors.${s.code}`) ? t(`layout.model.errors.${s.code}`) : t('layout.model.errors.other', { code: s.code })
    return [why, s.detail, m.hasModel ? t('layout.model.staleHint') : ''].filter(Boolean).join('\n')
  }
  if (s.state === 'running') return t('layout.model.refreshHint')
  return t('layout.model.frameworkHint')
})
const CHIP = {
  framework: { icon: Info, cls: 'text-well-ink' },
  ready: { icon: CircleCheck, cls: 'text-success' },
  running: { icon: LoaderCircle, cls: 'ccm-spin text-well-ink' },
  error: { icon: CircleX, cls: 'text-st-error' },
} as const
const prebuiltDate = computed(() => (prebuiltAt.value ? new Date(prebuiltAt.value).toLocaleDateString(uiLocale.value, { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''))
const showNotice = computed(() => !opts.value.compare && needsModelNotice(frameworkOnly.value || sourceOnly.value || !!prebuiltAt.value, diagnostics.value))
const compareFlat = computed(() => new Map<string, LayoutViewNode[]>(shots.value.map((s) => [s.cfg.id, s.res.ok ? flattenTree(s.res.viewTree) : []])))
const compareLayout = computed(() => {
  // Final cell count, not shots.length: cells arrive one by one and must not resize as they do.
  const n = compareConfigs(opts.value.device, opts.value.landscape, opts.value.density).length
  return shots.value.map((s) => {
    const w = s.res.ok ? s.res.width : s.cfg.device.width
    const h = s.res.ok ? s.res.height : s.cfg.device.height
    const { cellWidth, scale: k } = compareCellAt(w, h, box.value.width, box.value.height, n, opts.value.zoom)
    const viewTree = s.res.ok ? s.res.viewTree : null
    const boxes = opts.value.blueprint ? (compareFlat.value.get(s.cfg.id) ?? []).slice(0, BLUEPRINT_MAX) : []
    return { ...s, viewTree, boxes, cellWidth, scale: k, width: Math.round(w * k), height: Math.round(h * k) }
  })
})
const cellHover = shallowRef<{ id: string; node: LayoutViewNode | null } | null>(null)
watch([() => opts.value.zoom, () => opts.value.blueprint], () => (cellHover.value = null))

/** The selected view, or its counterpart by XML line in another cell's tree. */
function cellSelected(id: string, viewTree: LayoutViewNode | null): LayoutViewNode | null {
  const s = selected.value
  if (!s || !viewTree) return null
  if (compareFlat.value.get(id)?.includes(s)) return s
  return s.line > 0 ? nodeForLine(viewTree, s.line) : null
}

function shotLabel(cfg: CompareConfig): string {
  return t('layout.compare.cell', { device: t(`layout.device.${cfg.deviceId}`), theme: cfg.night ? t('layout.theme.dark') : t('layout.theme.light') })
}

async function loadModel(): Promise<void> {
  const file = props.path
  const info = await layoutModelStatus(file)
  if (file === props.path) model.value = info
}

async function pickApp(module: string): Promise<void> {
  const file = props.path
  const info = await layoutModelPick(file, module)
  if (file !== props.path || !info) return
  model.value = info
  schedule(0)
}

async function refreshModel(): Promise<void> {
  if (modelBusy.value) return
  modelBusy.value = true
  if (model.value) model.value = { ...model.value, state: { state: 'running', since: Date.now() } }
  try {
    const file = props.path
    const info = await layoutModelRefresh(file)
    if (file === props.path && info) model.value = info
  } finally {
    modelBusy.value = false
  }
  schedule(0)
}

watch(localeChoice, (v) => {
  if (v !== CUSTOM) opts.value.locale = v
})
function applyCustomLocale(): void {
  const v = customLocale.value.trim()
  if (/^[A-Za-z0-9+_-]{1,35}$/.test(v)) opts.value.locale = v
}

const errorText = computed(() => {
  const e = error.value
  if (!e) return ''
  return te(`layout.error.${e.code}`) ? t(`layout.error.${e.code}`) : t('layout.error.other', { code: e.code })
})

let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

/** v42: unsaved editor text (FilePane edit mode) instead of the file on disk. */
const liveText = (): { text?: string } => (props.text === null ? {} : { text: props.text })

function schedule(ms = 300): void {
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
  daemonStarting.value = status.value?.daemon !== 'ready'
  const theme = opts.value.theme || null
  const locale = opts.value.locale || null
  let res: LayoutRenderResult
  let usedScale = 1
  if (opts.value.compare) {
    const configs = compareConfigs(opts.value.device, opts.value.landscape, opts.value.density)
    // Cells of the same configurations keep their last frame until their own new one is decoded.
    const keep = new Map(shots.value.map((s) => [s.cfg.id, s]))
    let out = configs.flatMap((cfg) => {
      const old = keep.get(cfg.id)
      return old ? [{ cfg, res: old.res }] : []
    })
    if (out.length !== configs.length) out = []
    shots.value = out
    // Sequential: the daemon renders one at a time anyway, and each cell shows up as soon as it is ready.
    for (const [i, cfg] of configs.entries()) {
      const k = compareCellAt(cfg.device.width, cfg.device.height, box.value.width, box.value.height, configs.length, opts.value.zoom).scale
      const r = await layoutRender({ file: props.path, device: cfg.device, theme, night: cfg.night, locale, slot: i + 1, scale: renderScale(k, dpr()), ...liveText() })
      if (r.ok) await decoded(r.pngUrl)
      if (my !== seq) return
      const next = [...shots.value]
      next[i] = { cfg, res: r }
      shots.value = next
    }
    res = shots.value[0]!.res
  } else {
    shots.value = []
    usedScale = wantScale.value
    res = await layoutRender({ file: props.path, device: device.value, theme, night: opts.value.night, locale, slot: 0, scale: usedScale, ...liveText() })
    if (res.ok) await decoded(res.pngUrl)
    if (my !== seq) return
  }
  rendering.value = false
  daemonStarting.value = false
  if (status.value) status.value = { ...status.value, daemon: 'ready' }
  if (!res.ok) {
    if (res.code === 'cancelled') return
    staleFrame.value = false
    error.value = { code: res.code, detail: res.detail }
    if (res.code === 'bundle-missing' || res.code.startsWith('jdk')) void refreshStatus(false)
    return
  }
  error.value = null
  diagnostics.value = res.diagnostics
  renderMs.value = res.renderMs
  // Nothing drawn (e.g. half-typed XML): keep the last good frame and tree, dimmed, with the problems below.
  staleFrame.value = !res.pngUrl && !!pngUrl.value && !opts.value.compare
  if (staleFrame.value) return
  showFrame(res.pngUrl)
  shownScale.value = usedScale
  size.value = { width: res.width, height: res.height }
  tree.value = res.viewTree
  renderMs.value = res.renderMs
  cached.value = res.cached === true
  frameworkOnly.value = res.frameworkOnly === true
  builtinLibs.value = res.builtinLibs === true
  sourceOnly.value = res.sourceOnly === true
  prebuiltAt.value = typeof res.prebuiltAt === 'number' ? res.prebuiltAt : null
  hovered.value = null
  cellHover.value = null
  selected.value = props.line ? nodeForLine(res.viewTree, props.line) : null
}

async function refreshStatus(thenRender = true): Promise<void> {
  status.value = await layoutStatus()
  statusLoaded.value = true
  if (status.value?.daemon === 'starting' && status.value.stage) initStage.value = status.value.stage
  if (status.value?.bundle.state === 'downloading') downloadPct.value = status.value.bundle.pct
  if (thenRender && ready.value) schedule(0)
}

async function download(): Promise<void> {
  downloadPct.value = 0
  const res = await layoutDownload()
  downloadPct.value = null
  if (res && res.state !== 'cancelled' && status.value) status.value = { ...status.value, bundle: res }
  if (res?.state === 'ready') await refreshStatus()
}

async function chooseJdk(): Promise<void> {
  const dir = await desktop?.pickFolder?.(status.value?.jdk.ok ? status.value.jdk.home : undefined)
  if (!dir) return
  await desktop?.runSettingsSet?.({ jdk: dir })
  await refreshStatus()
}

const offEvent = onLayoutEvent((e) => {
  if (e.type === 'bundle') {
    downloadPct.value = e.status.state === 'downloading' ? e.status.pct : null
    if (status.value) status.value = { ...status.value, bundle: e.status }
    if (e.status.state === 'ready') void refreshStatus()
  } else if (e.type === 'daemon') {
    if (status.value) status.value = { ...status.value, daemon: e.state }
    daemonStarting.value = e.state === 'starting' && rendering.value
    if (e.state !== 'starting') initStage.value = null
  } else if (e.type === 'daemon-stage') {
    initStage.value = e.stage
  } else if (e.type === 'loading') {
    libsLoading.value = e.active ? e.kind : null
  } else {
    const target = model.value?.target
    if (!target || target.root !== e.root || target.module !== e.module) return
    if (e.type === 'code-changed') model.value = { ...model.value!, codeChanged: true }
    else if (e.type === 'project-changed') schedule(300)
    else if (e.state.state === 'ready') void loadModel()
    else if (model.value) model.value = { ...model.value, state: e.state }
  }
})

// Editor text is already debounced by FilePane; disk changes still coalesce a little.
watch(() => props.revision, () => schedule(props.text !== null ? 0 : 120))
watch(() => props.path, () => {
  pngUrl.value = null
  prevUrl.value = null
  staleFrame.value = false
  renderMs.value = null
  tree.value = null
  diagnostics.value = []
  shots.value = []
  void loadModel()
  schedule(0)
})
watch([device, () => opts.value.night, () => opts.value.locale, () => opts.value.theme, () => opts.value.compare], () => schedule(120))
watch(
  () => props.line,
  (line) => {
    selected.value = line ? nodeForLine(tree.value, line) : null
  },
)

function pointToImage(e: MouseEvent): { x: number; y: number } {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: (e.clientX - rect.left) / scale.value, y: (e.clientY - rect.top) / scale.value }
}

function onMove(e: MouseEvent): void {
  const p = pointToImage(e)
  hovered.value = hitTest(tree.value, p.x, p.y)
}

function pick(node: LayoutViewNode | null, select = true): void {
  if (!node) return
  selected.value = node
  if (node.line > 0) emit('reveal', node.line, select)
}

function onClick(e: MouseEvent): void {
  const p = pointToImage(e)
  pick(hitTest(tree.value, p.x, p.y))
}

function shotHit(e: MouseEvent, viewTree: LayoutViewNode | null, k: number): LayoutViewNode | null {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return hitTest(viewTree, (e.clientX - rect.left) / k, (e.clientY - rect.top) / k)
}

function onCellMove(e: MouseEvent, id: string, viewTree: LayoutViewNode | null, k: number): void {
  const node = shotHit(e, viewTree, k)
  if (cellHover.value?.id !== id || cellHover.value.node !== node) cellHover.value = { id, node }
}

/** Arrows walk `root` from `cur`, Enter jumps to the source line; shared by the single stage and each compare cell. */
function onTreeKey(e: KeyboardEvent, root: LayoutViewNode | null, cur: LayoutViewNode | null): void {
  if (!root || e.altKey || e.ctrlKey || e.metaKey) return
  if (e.key === 'Enter') return void pick(cur ?? root)
  if (!ARROW_KEYS.has(e.key)) return
  e.preventDefault()
  const next = stepView(root, cur, e.key)
  if (next) {
    selected.value = next
    if (next.line > 0) emit('reveal', next.line, false)
  }
}
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

function onCanvasKey(e: KeyboardEvent): void {
  onTreeKey(e, tree.value, selected.value)
}

const keysHint = computed(() => t('layout.keys', { enter: keyCombo(['Enter'], isMac) }))
const cellKeysHint = computed(() => `${keysHint.value}\n${t('layout.keysCompare', { back: keyCombo(['Shift', 'Tab'], isMac) })}`)

function cellLabel(s: { cfg: CompareConfig; viewTree: LayoutViewNode | null }): string {
  const sel = cellSelected(s.cfg.id, s.viewTree)
  return sel ? `${shotLabel(s.cfg)}: ${nodeLabel(sel)}, ${t('layout.view.line', { line: sel.line })}` : shotLabel(s.cfg)
}

function nodeLabel(n: LayoutViewNode): string {
  const cls = shortClass(n.class)
  return n.xmlId ? t('layout.view.id', { cls, id: n.xmlId.replace(/^@\+?id\//, '#') }) : t('layout.view.label', { cls })
}

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
  // Parallel to the status check: the JVM start is the slow part of the first render.
  void layoutWarmup(props.path)
  void loadModel()
  void refreshStatus()
})

onBeforeUnmount(() => {
  resize.disconnect()
  offEvent()
  if (timer) clearTimeout(timer)
  if (busyTimer) clearTimeout(busyTimer)
  if (prevTimer) clearTimeout(prevTimer)
  seq++
})
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-well text-well-ink" :aria-label="t('layout.mode.design')" data-layout-preview>
    <div class="ccm-material flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1" role="toolbar" :aria-label="t('layout.toolbar')">
      <AppSelect v-model="opts.device" :options="deviceOptions" :label="t('layout.device.label')" :icon="Smartphone" size="sm" />
      <button
        type="button"
        class="ccm-btn-plain shrink-0"
        :aria-pressed="opts.landscape"
        :title="t('layout.landscape')"
        :aria-label="t('layout.landscape')"
        @click="opts.landscape = !opts.landscape"
      >
        <RotateCcw :size="14" aria-hidden="true" />
      </button>
      <SegmentedControl v-model="themeValue" :options="themeOptions" :label="t('layout.theme.label')" icon-only />
      <AppSelect v-model="localeChoice" :options="localeOptions" :label="t('layout.locale.label')" size="sm" />
      <input
        v-if="localeChoice === CUSTOM"
        v-model="customLocale"
        class="ccm-field h-6 w-24 shrink-0 text-2xs"
        :placeholder="t('layout.locale.customLabel')"
        :aria-label="t('layout.locale.customLabel')"
        spellcheck="false"
        @keydown.enter="applyCustomLocale"
        @blur="applyCustomLocale"
      />
      <AppSelect v-model="opts.theme" :options="appThemeOptions" :label="t('layout.themePick.label')" :icon="Palette" size="sm" />
      <AppSelect v-model="densityChoice" :options="densityOptions" :label="t('layout.density.label')" size="sm" data-layout-density />
      <input
        v-if="densityChoice === CUSTOM"
        v-model="customDpi"
        type="number"
        :min="DPI_MIN"
        :max="DPI_MAX"
        class="ccm-field h-6 w-16 shrink-0 text-2xs tabular"
        :placeholder="t('layout.density.customLabel')"
        :aria-label="t('layout.density.customLabel')"
        :title="t('layout.density.customLabel')"
        @keydown.enter="applyCustomDpi"
        @blur="applyCustomDpi"
      />
      <span v-if="status?.apiLevel" class="shrink-0 text-2xs tabular" :title="t('layout.api.hint', { level: status.apiLevel })" data-layout-api>{{ t('layout.api.label', { level: status.apiLevel }) }}</span>
      <span class="flex-1" />
      <AppSelect v-if="appOptions.length" v-model="appPick" :options="appOptions" :label="t('layout.model.pickApp')" size="sm" data-layout-model-app />
      <span class="flex min-w-0 shrink items-center gap-1 text-2xs" :title="chipTitle" role="status" data-layout-model>
        <component :is="CHIP[chip.kind].icon" :size="13" class="shrink-0" :class="CHIP[chip.kind].cls" aria-hidden="true" />
        <span class="truncate tabular">{{ chipText }}</span>
      </span>
      <button
        v-if="model?.target"
        type="button"
        class="ccm-btn-plain shrink-0"
        :disabled="modelBusy || chip.kind === 'running'"
        :title="`${t('layout.model.refresh')}\n${t('layout.model.refreshHint')}`"
        :aria-label="t('layout.model.refresh')"
        data-layout-model-refresh
        @click="refreshModel"
      >
        <RefreshCw :size="14" aria-hidden="true" />
      </button>
      <AppSelect v-model="zoomValue" :options="zoomOptions" :label="t('layout.zoom.label')" :icon="ZoomIn" size="sm" />
      <button
        type="button"
        class="ccm-btn-plain shrink-0"
        :aria-pressed="opts.blueprint"
        :title="t('layout.blueprint')"
        :aria-label="t('layout.blueprint')"
        @click="opts.blueprint = !opts.blueprint"
      >
        <Frame :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="ccm-btn-plain shrink-0"
        :aria-pressed="opts.compare"
        :title="t('layout.compare.label')"
        :aria-label="t('layout.compare.label')"
        data-layout-compare
        @click="opts.compare = !opts.compare"
      >
        <Columns3 :size="14" aria-hidden="true" />
      </button>
    </div>

    <p v-if="ready && showNotice" class="flex shrink-0 items-start gap-2 border-b border-well-line px-3 py-1.5 text-xs" role="note" data-layout-model-notice>
      <Info :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ t(chip.kind === 'running' ? 'layout.model.noticeCompiling' : 'layout.model.notice') }}</span>
      <button v-if="model?.target && chip.kind !== 'running'" type="button" class="ccm-btn shrink-0" :disabled="modelBusy" :title="t('layout.model.refreshHint')" @click="refreshModel">
        {{ t('layout.model.refresh') }}
      </button>
    </p>

    <p v-if="ready && model?.codeChanged" class="flex shrink-0 items-start gap-2 border-b border-well-line px-3 py-1.5 text-xs" role="note" :title="t('layout.codeChangedHint')" data-layout-code-changed>
      <Hammer :size="14" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ t('layout.codeChanged') }}</span>
    </p>

    <div ref="canvas" class="ccm-scroll relative min-h-0 flex-1 overflow-auto">
      <div v-if="ready && busy && (hasFrame || opts.compare)" class="pointer-events-none sticky top-0 z-10 h-0" data-layout-busy>
        <div class="lp-busy-track absolute inset-x-0 top-0 h-0.5 overflow-hidden"><div class="lp-busy-bar h-full w-1/3 bg-accent" /></div>
        <span class="lp-wait-card absolute right-2 top-2 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs text-ink" role="status">
          <LoaderCircle :size="12" class="ccm-spin shrink-0" aria-hidden="true" />{{ waitTitle }}
        </span>
      </div>
      <div v-if="!statusLoaded" class="grid size-full place-items-center p-6 text-xs">
        <span class="flex items-center gap-2"><LoaderCircle :size="14" class="ccm-spin" aria-hidden="true" />{{ t('layout.setup.checking') }}</span>
      </div>

      <div v-else-if="!status || !status.jar" class="grid size-full place-items-center p-6">
        <p class="flex max-w-sm items-start gap-2 text-sm"><CircleAlert :size="16" class="mt-0.5 shrink-0 text-st-error" aria-hidden="true" />{{ status ? t('layout.setup.jarMissing') : t('layout.error.unavailable') }}</p>
      </div>

      <div v-else-if="!status.jdk.ok" class="grid size-full place-items-center p-6" data-layout-setup="jdk">
        <div class="flex max-w-sm flex-col items-center gap-2 text-center">
          <Coffee :size="26" aria-hidden="true" />
          <p class="text-sm text-well-ink">{{ status.jdk.code === 'jdk-old' ? t('layout.setup.jdkOld', { version: status.jdk.detail ?? '?' }) : t('layout.setup.jdkMissing') }}</p>
          <p class="text-xs text-well-ink">{{ t('layout.setup.jdkHint') }}</p>
          <button type="button" class="ccm-btn mt-1" @click="chooseJdk">{{ t('layout.setup.chooseJdk') }}</button>
        </div>
      </div>

      <div v-else-if="status.bundle.state !== 'ready'" class="grid size-full place-items-center p-6" data-layout-setup="bundle">
        <div class="flex w-full max-w-sm flex-col items-center gap-2 text-center">
          <Download :size="26" aria-hidden="true" />
          <p class="text-sm font-semibold">{{ t('layout.setup.bundleTitle') }}</p>
          <p class="text-xs">{{ t('layout.setup.bundleBody') }}</p>
          <template v-if="downloadPct !== null || status.bundle.state === 'downloading'">
            <div
              class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-well-line"
              role="progressbar"
              :aria-valuenow="downloadPct ?? 0"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="t('layout.setup.downloading', { pct: downloadPct ?? 0 })"
            >
              <div class="h-full origin-left rounded-full bg-accent transition-transform duration-(--ccm-dur-base)" :style="{ transform: `scaleX(${(downloadPct ?? 0) / 100})` }" />
            </div>
            <p class="text-2xs tabular" aria-live="polite">{{ t('layout.setup.downloading', { pct: downloadPct ?? 0 }) }}</p>
          </template>
          <template v-else>
            <p v-if="status.bundle.state === 'error'" class="flex items-center gap-1.5 text-xs" role="alert">
              <CircleAlert :size="14" class="shrink-0 text-st-error" aria-hidden="true" />{{ t('layout.setup.bundleError', { code: status.bundle.code }) }}
            </p>
            <button type="button" class="ccm-btn-primary mt-1" data-layout-download @click="download">
              {{ status.bundle.state === 'error' ? t('layout.setup.retry') : t('layout.setup.download') }}
            </button>
          </template>
        </div>
      </div>

      <div
        v-else-if="opts.compare"
        class="flex min-h-full w-full flex-wrap items-start gap-4 p-4 [align-content:safe_center] [justify-content:safe_center]"
        role="group"
        :aria-label="t('layout.compare.strip')"
        data-layout-compare-strip
      >
        <figure v-for="s in compareLayout" :key="s.cfg.id" class="flex min-w-0 shrink-0 flex-col items-center gap-1.5" :style="{ width: `${s.cellWidth}px` }">
          <div
            class="relative shrink-0 overflow-hidden rounded-inner shadow-card outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            :class="opts.blueprint && s.res.ok ? 'bg-well ring-1 ring-well-line' : 'bg-page'"
            :style="{ width: `${s.width}px`, height: `${s.height}px` }"
            :tabindex="s.res.ok ? 0 : -1"
            role="group"
            :aria-label="cellLabel(s)"
            :aria-description="s.res.ok ? cellKeysHint : undefined"
            data-layout-compare-cell
            @mousemove="onCellMove($event, s.cfg.id, s.viewTree, s.scale)"
            @mouseleave="cellHover = null"
            @click="s.res.ok && pick(shotHit($event, s.viewTree, s.scale))"
            @keydown="s.res.ok && onTreeKey($event, s.viewTree, cellSelected(s.cfg.id, s.viewTree))"
          >
            <img v-if="s.res.ok && s.res.pngUrl && !opts.blueprint" :src="s.res.pngUrl" :alt="shotLabel(s.cfg)" class="pointer-events-none block size-full select-none" draggable="false" />
            <LayoutBoxes
              v-if="s.res.ok"
              :nodes="s.boxes"
              :scale="s.scale"
              :hovered="cellHover?.id === s.cfg.id ? cellHover.node : null"
              :selected="cellSelected(s.cfg.id, s.viewTree)"
            />
            <p v-if="!s.res.ok || (!s.res.pngUrl && !opts.blueprint)" class="absolute inset-0 grid place-items-center p-3 text-center text-xs text-well-ink">
              <span class="flex items-center gap-1.5"><CircleAlert :size="13" class="shrink-0 text-st-error" aria-hidden="true" />{{ s.res.ok ? t('layout.noImage') : te(`layout.error.${s.res.code}`) ? t(`layout.error.${s.res.code}`) : t('layout.error.other', { code: s.res.code }) }}</span>
            </p>
          </div>
          <figcaption class="w-full min-w-0 truncate text-center text-2xs" :title="shotLabel(s.cfg)" data-layout-compare-caption>{{ shotLabel(s.cfg) }}</figcaption>
        </figure>
      </div>

      <div v-else class="grid min-h-full min-w-full place-items-center p-4">
        <div
          class="relative shrink-0 overflow-hidden rounded-inner shadow-card outline-none focus-visible:outline-2 focus-visible:outline-focus"
          :class="opts.blueprint ? 'bg-well ring-1 ring-well-line' : 'bg-page'"
          :style="{ width: `${stage.width}px`, height: `${stage.height}px`, ...stageMotion }"
          tabindex="0"
          role="group"
          :aria-description="keysHint"
          :aria-label="selected ? `${nodeLabel(selected)}, ${t('layout.view.line', { line: selected.line })}` : t('layout.image')"
          data-layout-stage
          @mousemove="onMove"
          @mouseleave="hovered = null"
          @click="onClick"
          @keydown="onCanvasKey"
        >
          <img v-if="prevUrl && pngUrl && !opts.blueprint" :src="prevUrl" alt="" aria-hidden="true" class="pointer-events-none absolute inset-0 block size-full select-none" draggable="false" />
          <img
            v-if="pngUrl && !opts.blueprint"
            :key="frameSeq"
            :src="pngUrl"
            :alt="t('layout.image')"
            class="pointer-events-none relative block size-full select-none"
            :class="[frameSeq === 1 && !prevUrl ? 'lp-frame-first' : 'lp-frame-in', error || staleFrame ? 'lp-stale' : '']"
            draggable="false"
            data-layout-frame
          />
          <div v-else-if="awaitingFirst && !opts.blueprint" class="absolute inset-0" aria-hidden="true" data-layout-skeleton>
            <div class="lp-skel-bar left-0 right-0 top-0 h-[7%]" />
            <div class="lp-skel-bar left-[6%] top-[11%] h-[3%] w-[52%]" />
            <div class="lp-skel-bar left-[6%] top-[16%] h-[2%] w-[78%] [animation-delay:120ms]" />
            <div class="lp-skel-bar left-[6%] top-[21%] h-[18%] w-[88%] [animation-delay:240ms]" />
            <div class="lp-skel-bar left-[6%] top-[43%] h-[2%] w-[64%] [animation-delay:360ms]" />
            <div class="lp-skel-bar bottom-[5%] right-[6%] h-[5%] w-[30%] [animation-delay:480ms]" />
          </div>
          <p v-else-if="!opts.blueprint && !rendering && tree === null && !error" class="absolute inset-0 grid place-items-center p-4 text-center text-xs text-well-ink">{{ t('layout.noImage') }}</p>
          <div v-if="awaitingFirst" class="absolute inset-0 grid place-items-center p-3" data-layout-wait :data-stage="starting ? (initStage ?? 'jvm') : libsLoading ?? 'render'">
            <div class="lp-wait-card flex w-full max-w-60 flex-col items-center gap-1.5 rounded-inner px-3 py-2.5 text-center" role="status" aria-live="polite">
              <span class="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <LoaderCircle :size="13" class="ccm-spin shrink-0" aria-hidden="true" />{{ waitTitle }}
              </span>
              <span v-if="waitDetail" class="text-2xs text-ink-muted">{{ waitDetail }}</span>
              <div
                v-if="starting"
                class="mt-1 h-1 w-full overflow-hidden rounded-full bg-well-line"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="stageProgress.pct"
                :aria-label="t('layout.wait.progress')"
                data-layout-progress
              >
                <div class="lp-progress h-full origin-left rounded-full bg-accent" :style="{ transform: `scaleX(${stageProgress.pct / 100})`, transitionDuration: `${stageProgress.ms}ms` }" />
              </div>
              <span v-if="starting" class="text-2xs text-ink-muted">{{ t('layout.wait.firstStart') }}</span>
            </div>
          </div>
          <p v-if="(error || staleFrame) && pngUrl && !opts.blueprint" class="lp-stale-note absolute inset-x-2 bottom-2 flex items-start gap-1.5 rounded-inner px-2 py-1 text-2xs" role="note" data-layout-stale>
            <CircleAlert :size="12" class="mt-px shrink-0 text-st-error" aria-hidden="true" />
            <span class="min-w-0">{{ t('layout.staleFrame') }}</span>
          </p>
          <LayoutBoxes :nodes="nodes" :scale="scale" :hovered="hovered" :selected="selected" />
        </div>
      </div>
    </div>

    <div v-if="ready && diagnostics.length" class="ccm-scroll max-h-[30%] shrink-0 overflow-auto border-t border-well-line" data-layout-diagnostics>
      <h3 class="px-3 pt-1.5 text-2xs font-semibold">{{ t('layout.diagnostics.title', { n: diagnostics.length }) }}</h3>
      <ul class="py-1">
        <li v-for="(d, i) in diagnostics" :key="i">
          <button
            type="button"
            class="flex w-full items-start gap-2 px-3 py-1 text-left text-xs hover:bg-well-line disabled:cursor-default"
            :disabled="!d.line"
            :title="d.line ? t('layout.diagnostics.goTo', { line: d.line }) : undefined"
            @click="d.line && emit('reveal', d.line, true)"
          >
            <component :is="SEVERITY[d.severity].icon" :size="13" class="mt-0.5 shrink-0" :class="SEVERITY[d.severity].cls" aria-hidden="true" />
            <span class="min-w-0 flex-1 break-words">{{ d.message }}</span>
            <span v-if="d.line" class="shrink-0 text-2xs tabular">{{ t('layout.diagnostics.line', { line: d.line }) }}</span>
          </button>
        </li>
      </ul>
    </div>

    <p v-if="ready" class="flex h-7 shrink-0 items-center gap-1.5 border-t border-well-line px-3 text-2xs" role="status" aria-live="polite" data-layout-status>
      <template v-if="rendering">
        <LoaderCircle :size="13" class="ccm-spin shrink-0" aria-hidden="true" />{{ daemonStarting ? t('layout.status.starting') : t('layout.status.rendering') }}
      </template>
      <template v-else-if="error">
        <CircleAlert :size="13" class="shrink-0 text-st-error" aria-hidden="true" />
        <span class="truncate" :title="error.detail || errorText">{{ t('layout.status.error') }} · {{ errorText }}</span>
      </template>
      <template v-else-if="renderMs !== null">
        <CircleCheck :size="13" class="shrink-0 text-success" aria-hidden="true" />
        <span class="tabular">{{ cached ? t('layout.status.cached') : t('layout.status.done', { ms: renderMs }) }}</span>
        <span v-if="selected" class="ml-auto truncate">{{ nodeLabel(selected) }} · {{ t('layout.view.line', { line: selected.line }) }}</span>
      </template>
    </p>
  </section>
</template>

<style scoped>
.lp-frame-in {
  animation: lp-fade var(--ccm-dur-fast) var(--ease-out-quint) both;
}
.lp-frame-first {
  animation: lp-first var(--ccm-dur-base) var(--ease-out-quint) both;
}
.lp-stale {
  opacity: 0.45;
  transition: opacity var(--ccm-dur-base) var(--ease-out-quint);
}
.lp-stale-note,
.lp-wait-card {
  background: var(--ccm-surface);
  color: var(--ccm-ink);
  box-shadow: var(--ccm-shadow);
}
.lp-skel-bar {
  position: absolute;
  border-radius: 4px;
  background: var(--ccm-well-line);
  animation: ccm-shimmer 1.4s ease-in-out infinite;
}
.lp-progress {
  transition-property: transform;
  transition-timing-function: var(--ease-out-quint);
}
.lp-busy-track {
  background: color-mix(in srgb, var(--ccm-accent) 18%, transparent);
}
.lp-busy-bar {
  animation: lp-slide 1.1s var(--ease-out-quint) infinite;
}
@keyframes lp-fade {
  from {
    opacity: 0;
  }
}
@keyframes lp-first {
  from {
    opacity: 0;
    transform: scale(0.985);
  }
}
@keyframes lp-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .lp-frame-in,
  .lp-frame-first,
  .lp-skel-bar,
  .lp-busy-bar {
    animation: none;
  }
  .lp-busy-bar {
    width: 100%;
    opacity: 0.6;
  }
  .lp-progress,
  .lp-stale {
    transition: none;
  }
}
</style>
