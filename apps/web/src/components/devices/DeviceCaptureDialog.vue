<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Accessibility, Bot, Camera, CircleAlert, CircleCheck, CircleDot, LoaderCircle, Paperclip, RefreshCw, Save, ScanSearch, Search, Square, Trash2, TriangleAlert, Video, X } from 'lucide-vue-next'
import type { DevErrorCode, DevUiNode } from '@ccm/shared'
import { useDeviceHandoff } from '../../composables/useDeviceHandoff'
import { a11yCheck, a11yPrompt, CONTRAST_LARGE, nodeRef, type A11yFinding, type Pixels } from '../../lib/deviceA11y'
import { boundsText, hasArea, idName, nodeAt, nodePrompt, nodeSearch, pathTo, shortClass } from '../../lib/deviceInspect'
import { devRecCancel, devRecDiscard, devRecSave, devRecStart, devRecStop, devScreencap, devUiDump, hasDeviceRecord } from '../../lib/devices'
import { retireOverlay } from '../../lib/motion'
import { hasSearch, searchFiles } from '../../lib/preview'

const props = defineProps<{ open: boolean; deviceId: string | null; deviceName: string; root?: string | null }>()
const emit = defineEmits<{ close: [] }>()

const { t, te } = useI18n()
const handoff = useDeviceHandoff(() => props.root ?? null)

const dialog = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const shot = ref<{ png: string; width: number; height: number } | null>(null)
const capturing = ref(false)
const error = ref<{ code: DevErrorCode; detail?: string } | null>(null)
const note = ref<{ text: string; warn: boolean } | null>(null)
const inspecting = ref(false)
const a11yOn = ref(false)
const dumping = ref(false)
const nodes = ref<DevUiNode[] | null>(null)
const density = ref<number | null>(null)
const pixels = shallowRef<{ png: string; px: Pixels | null } | null>(null)
const picked = ref(-1)
const filling = ref(false)
const selected = ref(-1)
const hovered = ref(-1)
const fit = ref({ w: 0, h: 0 })
let gen = 0
let restoreFocus: HTMLElement | null = null

const errorText = computed(() => {
  const code = error.value?.code
  if (!code) return ''
  if (te(`deviceRec.error.${code}`)) return t(`deviceRec.error.${code}`)
  return t(te(`devices.error.${code}`) ? `devices.error.${code}` : 'devices.error.denied')
})
const boxes = computed(() => (nodes.value ?? []).map((n, i) => ({ n, i })).filter(({ n }) => hasArea(n)))
const node = computed(() => (selected.value >= 0 ? (nodes.value?.[selected.value] ?? null) : null))
const crumbs = computed(() => (nodes.value && selected.value >= 0 ? pathTo(nodes.value, selected.value).slice(-4) : []))
const query = computed(() => (node.value ? nodeSearch(node.value) : null))

const report = computed(() => {
  const s = shot.value
  const p = pixels.value
  if (!a11yOn.value || !nodes.value || !s || !p || p.png !== s.png) return null
  return a11yCheck(nodes.value, { density: density.value, screen: { width: s.width, height: s.height }, pixels: p.px })
})
const flagged = computed(() => [...new Set((report.value?.findings ?? []).map((f) => f.node))].filter((i) => nodes.value?.[i]))
const finding = computed(() => (picked.value >= 0 ? (report.value?.findings[picked.value] ?? null) : null))
const dpPx = computed(() => (density.value ? Math.round((density.value / 160) * 100) / 100 : null))

function say(text: string, warn = false): void {
  note.value = { text, warn }
}

async function capture(): Promise<void> {
  const id = props.deviceId
  if (!id) return
  const my = ++gen
  capturing.value = true
  error.value = null
  note.value = null
  nodes.value = null
  selected.value = -1
  picked.value = -1
  try {
    const r = await devScreencap(id)
    if (my !== gen) return
    if (r.ok) shot.value = { png: r.png, width: r.width, height: r.height }
    else error.value = { code: r.error, detail: r.detail }
  } finally {
    if (my === gen) capturing.value = false
  }
  if (my === gen && shot.value && (inspecting.value || a11yOn.value)) await dump()
}

async function dump(): Promise<void> {
  const id = props.deviceId
  if (!id) return
  const my = gen
  dumping.value = true
  try {
    const r = await devUiDump(id)
    if (my !== gen) return
    if (r.ok) {
      nodes.value = r.nodes
      density.value = r.density ?? null
    } else error.value = { code: r.error, detail: r.detail }
  } finally {
    if (my === gen) dumping.value = false
  }
}

function loadPixels(png: string): Promise<Pixels | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx || !c.width || !c.height) return resolve(null)
        ctx.drawImage(img, 0, 0)
        resolve(ctx.getImageData(0, 0, c.width, c.height))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = png
  })
}

watch([shot, a11yOn], async ([s, on]) => {
  if (!on || !s || pixels.value?.png === s.png) return
  const px = await loadPixels(s.png)
  if (shot.value?.png === s.png) pixels.value = { png: s.png, px }
})

function toggleInspect(): void {
  inspecting.value = !inspecting.value
  if (inspecting.value) a11yOn.value = false
  if (inspecting.value && !nodes.value && shot.value) void dump()
}

function toggleA11y(): void {
  a11yOn.value = !a11yOn.value
  picked.value = -1
  if (a11yOn.value) inspecting.value = false
  if (a11yOn.value && !nodes.value && shot.value) void dump()
}

function pointAt(e: MouseEvent): number {
  const s = shot.value
  const el = e.currentTarget as SVGElement
  if (!s || !nodes.value) return -1
  const r = el.getBoundingClientRect()
  return nodeAt(nodes.value, ((e.clientX - r.left) / r.width) * s.width, ((e.clientY - r.top) / r.height) * s.height)
}

function findingAt(e: MouseEvent): number {
  const s = shot.value
  const list = report.value?.findings
  if (!s || !list || !nodes.value) return -1
  const r = (e.currentTarget as SVGElement).getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * s.width
  const y = ((e.clientY - r.top) / r.height) * s.height
  const inside = flagged.value.map((i) => nodes.value![i]!)
  const hit = nodeAt(inside, x, y)
  return hit < 0 ? -1 : list.findIndex((f) => f.node === flagged.value[hit])
}

function onPick(e: MouseEvent): void {
  if (a11yOn.value) {
    picked.value = findingAt(e)
    return
  }
  if (!inspecting.value) return
  selected.value = pointAt(e)
  note.value = selected.value < 0 ? { text: t('deviceTools.inspect.none'), warn: false } : null
}

function onHover(e: MouseEvent): void {
  if (inspecting.value) hovered.value = pointAt(e)
}

function detailOf(f: A11yFinding): string {
  if (f.kind === 'small-target') return t('deviceA11y.detail.small-target', { w: f.wDp, h: f.hDp })
  if (f.kind === 'low-contrast') return t(`deviceA11y.detail.${(f.ratio ?? 0) >= CONTRAST_LARGE ? 'low-contrast-large' : 'low-contrast'}`, { ratio: f.ratio })
  if (f.kind === 'dup-label') return t('deviceA11y.detail.dup-label', { label: f.label })
  return t('deviceA11y.detail.no-label')
}

function findingQuery(f: A11yFinding) {
  const n = nodes.value?.[f.node]
  return n ? nodeSearch(n) : null
}

function findFinding(f: A11yFinding): void {
  const q = findingQuery(f)
  if (!q) return
  handoff.findInFiles(q)
  emit('close')
}

async function fillA11y(): Promise<void> {
  const r = report.value
  const list = nodes.value
  if (!r || !list || !r.findings.length) return
  const pane = handoff.target()
  if (!pane) return say(t('deviceA11y.noAgent'), true)
  const root = props.root ?? (pane as { cwd?: string }).cwd ?? null
  const hits = new Map<number, string[]>()
  filling.value = true
  try {
    if (root && hasSearch) {
      const byQuery = new Map<string, number[]>()
      for (const f of r.findings) {
        const q = findingQuery(f)
        if (q) byQuery.set(JSON.stringify(q), [...(byQuery.get(JSON.stringify(q)) ?? []), f.node])
      }
      for (const [key, at] of [...byQuery].slice(0, 20)) {
        const res = await searchFiles(root, JSON.parse(key))
        if (!res.ok) continue
        const files = res.matches.slice(0, 3).map((m) => `${m.path}:${m.line}`)
        for (const i of at) hits.set(i, files)
      }
    }
  } finally {
    filling.value = false
  }
  if (handoff.fillText(a11yPrompt(list, r.findings, props.deviceName, hits)) === 'ok') emit('close')
  else say(t('deviceA11y.noAgent'), true)
}

async function attach(): Promise<void> {
  if (!shot.value) return
  const r = await handoff.attachShot(shot.value.png, props.deviceName)
  if (r === 'ok') emit('close')
  else say(t(r === 'no-agent' ? 'deviceTools.capture.noAgent' : 'deviceTools.capture.failed'), true)
}

function fill(): void {
  if (!node.value) return
  const r = handoff.fillText(nodePrompt(node.value, props.deviceName))
  if (r === 'ok') emit('close')
  else say(t('deviceTools.capture.noAgent'), true)
}

function find(): void {
  if (!query.value) return
  handoff.findInFiles(query.value)
  emit('close')
}

type Rec =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'recording'; startedAt: number; limitMs: number }
  | { phase: 'stopping' }
  | { phase: 'done'; token: string; bytes: number; durationMs: number; frames: string[]; framesFailed: number }
const rec = ref<Rec>({ phase: 'idle' })
const now = ref(Date.now())
let recId: string | null = null
let recGen = 0
let tick: ReturnType<typeof setInterval> | null = null

const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const sizeText = (b: number): string => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const elapsed = computed(() => (rec.value.phase === 'recording' ? Math.min(now.value - rec.value.startedAt, rec.value.limitMs) : 0))
const recBusy = computed(() => rec.value.phase === 'starting' || rec.value.phase === 'recording' || rec.value.phase === 'stopping')
const recName = (): string => props.deviceName.replace(/[^\w.-]+/g, '-') || 'device'

function stopTick(): void {
  if (tick) clearInterval(tick)
  tick = null
}

async function startRec(): Promise<void> {
  const id = props.deviceId
  if (!id || rec.value.phase !== 'idle') return
  const my = ++recGen
  recId = id
  rec.value = { phase: 'starting' }
  error.value = null
  note.value = null
  const r = await devRecStart(id)
  if (my !== recGen) {
    if (r.ok) void devRecCancel(id)
    return
  }
  if (!r.ok) {
    rec.value = { phase: 'idle' }
    error.value = { code: r.error, detail: r.detail }
    return
  }
  const startedAt = Date.now()
  now.value = startedAt
  rec.value = { phase: 'recording', startedAt, limitMs: r.limitMs }
  stopTick()
  tick = setInterval(() => {
    now.value = Date.now()
    if (rec.value.phase === 'recording' && now.value - rec.value.startedAt >= rec.value.limitMs) void stopRec()
  }, 250)
}

async function stopRec(): Promise<void> {
  if (rec.value.phase !== 'recording' || !recId) return
  stopTick()
  const my = recGen
  rec.value = { phase: 'stopping' }
  const r = await devRecStop(recId)
  if (my !== recGen) {
    if (r.ok) void devRecDiscard(r.token)
    return
  }
  if (r.ok) rec.value = { phase: 'done', token: r.token, bytes: r.bytes, durationMs: r.durationMs, frames: r.frames, framesFailed: r.framesFailed }
  else {
    rec.value = { phase: 'idle' }
    error.value = { code: r.error, detail: r.detail }
  }
}

/** Dialog closed / Discard: whatever runs on the device stops and every file goes. */
function dropRec(): void {
  recGen++
  stopTick()
  const r = rec.value
  if ((r.phase === 'recording' || r.phase === 'stopping') && recId) void devRecCancel(recId)
  if (r.phase === 'done') void devRecDiscard(r.token)
  rec.value = { phase: 'idle' }
}

async function saveRec(): Promise<void> {
  const r = rec.value
  if (r.phase !== 'done') return
  const res = await devRecSave(r.token, `${recName()}-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`)
  if (res.ok) say(t('deviceRec.saved', { name: res.name }))
  else if (res.error !== 'cancelled') error.value = { code: res.error, detail: res.detail }
}

async function attachFrames(): Promise<void> {
  const r = rec.value
  if (r.phase !== 'done') return
  if (!r.frames.length) return say(t('deviceRec.noFrames'), true)
  for (const [i, png] of r.frames.entries()) {
    const res = await handoff.attachShot(png, recName(), i + 1)
    if (res !== 'ok') return say(t(res === 'no-agent' ? 'deviceTools.capture.noAgent' : 'deviceTools.capture.failed'), true)
  }
  say(t('deviceRec.attached'))
}

let observer: ResizeObserver | null = null
function layout(): void {
  const s = shot.value
  const el = stage.value
  if (!s || !el) return
  const scale = Math.min(el.clientWidth / s.width, el.clientHeight / s.height, 1)
  fit.value = { w: Math.max(1, Math.floor(s.width * scale)), h: Math.max(1, Math.floor(s.height * scale)) }
}
watch([shot, stage], () => {
  observer?.disconnect()
  if (stage.value) {
    observer = new ResizeObserver(layout)
    observer.observe(stage.value)
  }
  layout()
})

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
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

watch(
  () => props.open,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      shot.value = null
      pixels.value = null
      void capture()
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('[data-capture-close]')?.focus()
    } else {
      gen++
      dropRec()
      observer?.disconnect()
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  observer?.disconnect()
  dropRec()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-4 py-[4vh]" @mousedown.self="emit('close')">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="device-capture-title"
          class="flex h-[90vh] w-full max-w-[1100px] flex-col overflow-hidden ccm-sheet"
          data-device-capture
          @keydown="trap"
        >
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line py-2.5 pr-3 pl-4">
            <Camera :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="device-capture-title" class="truncate text-sm font-semibold">{{ t('deviceTools.capture.title', { name: deviceName }) }}</h2>
              <p v-if="shot" class="text-2xs text-ink-faint">{{ t('deviceTools.capture.size', { w: shot.width, h: shot.height }) }}</p>
            </div>
            <button type="button" class="ccm-btn" :aria-pressed="inspecting" :class="inspecting ? 'bg-accent-soft! text-accent-ink!' : ''" :disabled="!shot" data-capture-inspect @click="toggleInspect">
              <ScanSearch :size="13" aria-hidden="true" />{{ t('deviceTools.inspect.toggle') }}
            </button>
            <button
              type="button"
              class="ccm-btn"
              :aria-pressed="a11yOn"
              :class="a11yOn ? 'bg-accent-soft! text-accent-ink!' : ''"
              :disabled="!shot"
              :title="t('deviceA11y.toggleHint')"
              data-capture-a11y
              @click="toggleA11y"
            >
              <Accessibility :size="13" aria-hidden="true" />{{ t('deviceA11y.toggle') }}
            </button>
            <button
              v-if="hasDeviceRecord"
              type="button"
              class="ccm-btn"
              :disabled="!deviceId || rec.phase !== 'idle'"
              :title="t('deviceRec.recordHint')"
              data-capture-record
              @click="startRec"
            >
              <Video :size="13" aria-hidden="true" />{{ t('deviceRec.record') }}
            </button>
            <button type="button" class="ccm-btn" :disabled="capturing" data-capture-retake @click="capture">
              <RefreshCw :size="13" aria-hidden="true" />{{ t('deviceTools.capture.retake') }}
            </button>
            <button type="button" class="ccm-btn ccm-btn-primary" :disabled="!shot || capturing" data-capture-attach @click="attach">
              <Paperclip :size="13" aria-hidden="true" />{{ t('deviceTools.capture.attach') }}
            </button>
            <button type="button" class="ccm-btn-plain" :title="t('deviceTools.capture.close')" :aria-label="t('deviceTools.capture.close')" data-capture-close @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </div>

          <div v-if="rec.phase !== 'idle'" class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-fill px-4 py-2 text-xs" role="status" data-capture-recording :data-rec-phase="rec.phase">
            <template v-if="rec.phase === 'starting' || rec.phase === 'stopping'">
              <LoaderCircle :size="14" class="ccm-spin text-ink-muted" aria-hidden="true" />
              <span class="text-ink-muted">{{ t(rec.phase === 'starting' ? 'deviceRec.starting' : 'deviceRec.stopping') }}</span>
            </template>
            <template v-else-if="rec.phase === 'recording'">
              <CircleDot :size="14" class="text-warning" aria-hidden="true" />
              <span class="font-medium tabular-nums" data-rec-elapsed>{{ t('deviceRec.recording', { elapsed: clock(elapsed), limit: clock(rec.limitMs) }) }}</span>
              <button type="button" class="ccm-btn ml-auto" data-rec-stop @click="stopRec">
                <Square :size="12" aria-hidden="true" />{{ t('deviceRec.stop') }}
              </button>
              <button type="button" class="ccm-btn" data-rec-cancel @click="dropRec">{{ t('deviceRec.cancel') }}</button>
            </template>
            <template v-else-if="rec.phase === 'done'">
              <Video :size="14" class="text-ink-muted" aria-hidden="true" />
              <div class="min-w-0">
                <p class="font-medium tabular-nums" data-rec-result>{{ t('deviceRec.result', { duration: clock(rec.durationMs), size: sizeText(rec.bytes) }) }}</p>
                <p class="text-2xs text-ink-faint" data-rec-frames-count>
                  {{ t('deviceRec.frames', rec.frames.length) }}<template v-if="rec.framesFailed"> · {{ t('deviceRec.framesFailed') }}</template>
                </p>
              </div>
              <div v-if="rec.frames.length" class="flex min-w-0 gap-1 overflow-hidden">
                <img v-for="(f, i) in rec.frames" :key="i" :src="f" :alt="t('deviceRec.frame', { n: i + 1 })" class="h-10 w-auto rounded-inner border border-line" draggable="false" data-rec-frame />
              </div>
              <div class="ml-auto flex flex-wrap gap-1.5">
                <button type="button" class="ccm-btn" data-rec-save @click="saveRec"><Save :size="13" aria-hidden="true" />{{ t('deviceRec.save') }}</button>
                <button type="button" class="ccm-btn" :disabled="!rec.frames.length" :title="t('deviceRec.attachHint')" data-rec-attach @click="attachFrames">
                  <Paperclip :size="13" aria-hidden="true" />{{ t('deviceRec.attach') }}
                </button>
                <button type="button" class="ccm-btn-plain" :title="t('deviceRec.discard')" :aria-label="t('deviceRec.discard')" data-rec-discard @click="dropRec">
                  <Trash2 :size="13" aria-hidden="true" />
                </button>
              </div>
            </template>
          </div>

          <div v-if="error || note" class="flex shrink-0 items-start gap-1.5 border-b border-line px-4 py-2 text-xs" :class="error || note?.warn ? 'bg-warning-soft' : 'bg-fill'" role="alert" data-capture-error>
            <CircleAlert :size="14" class="mt-px shrink-0" :class="error || note?.warn ? 'text-warning' : 'text-ink-muted'" aria-hidden="true" />
            <p class="min-w-0 flex-1">
              {{ error ? errorText : note?.text }}
              <span v-if="error?.detail" class="ml-1 line-clamp-2 font-mono text-2xs break-all text-ink-muted" :title="error.detail">{{ error.detail }}</span>
            </p>
          </div>

          <div class="flex min-h-0 flex-1 flex-col md:flex-row">
            <div ref="stage" class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center bg-well p-3">
              <div v-if="capturing && !shot" class="flex items-center gap-2 text-xs text-ink-muted">
                <LoaderCircle :size="14" class="ccm-spin" aria-hidden="true" />{{ t('deviceTools.capture.loading') }}
              </div>
              <div v-else-if="shot" class="relative shrink-0 shadow-card" :style="{ width: `${fit.w}px`, height: `${fit.h}px` }">
                <img :src="shot.png" :alt="t('deviceTools.capture.image', { name: deviceName })" class="block size-full select-none" draggable="false" :class="capturing ? 'opacity-60' : ''" />
                <svg
                  v-if="(inspecting || a11yOn) && nodes"
                  class="absolute inset-0 size-full"
                  :class="inspecting ? 'cursor-crosshair' : ''"
                  :viewBox="`0 0 ${shot.width} ${shot.height}`"
                  preserveAspectRatio="none"
                  data-capture-overlay
                  @mousemove="onHover"
                  @mouseleave="hovered = -1"
                  @click="onPick"
                >
                  <template v-if="inspecting">
                    <rect
                      v-for="b in boxes"
                      :key="b.i"
                      :x="b.n.bounds[0]"
                      :y="b.n.bounds[1]"
                      :width="b.n.bounds[2] - b.n.bounds[0]"
                      :height="b.n.bounds[3] - b.n.bounds[1]"
                      fill="none"
                      stroke="var(--ccm-line-strong)"
                      stroke-width="1"
                      vector-effect="non-scaling-stroke"
                    />
                    <rect
                      v-if="hovered >= 0 && hovered !== selected && nodes[hovered]"
                      :x="nodes[hovered]!.bounds[0]"
                      :y="nodes[hovered]!.bounds[1]"
                      :width="nodes[hovered]!.bounds[2] - nodes[hovered]!.bounds[0]"
                      :height="nodes[hovered]!.bounds[3] - nodes[hovered]!.bounds[1]"
                      fill="none"
                      stroke="var(--ccm-focus)"
                      stroke-width="1.5"
                      vector-effect="non-scaling-stroke"
                    />
                    <rect
                      v-if="node"
                      :x="node.bounds[0]"
                      :y="node.bounds[1]"
                      :width="node.bounds[2] - node.bounds[0]"
                      :height="node.bounds[3] - node.bounds[1]"
                      fill="var(--ccm-accent-soft)"
                      stroke="var(--ccm-accent)"
                      stroke-width="2"
                      vector-effect="non-scaling-stroke"
                      data-capture-selected
                    />
                  </template>
                  <template v-else>
                    <rect
                      v-for="i in flagged"
                      :key="i"
                      class="cursor-pointer"
                      :x="nodes[i]!.bounds[0]"
                      :y="nodes[i]!.bounds[1]"
                      :width="nodes[i]!.bounds[2] - nodes[i]!.bounds[0]"
                      :height="nodes[i]!.bounds[3] - nodes[i]!.bounds[1]"
                      :fill="finding?.node === i ? 'var(--ccm-accent-soft)' : 'transparent'"
                      :stroke="finding?.node === i ? 'var(--ccm-accent)' : 'var(--ccm-warning)'"
                      stroke-width="2"
                      vector-effect="non-scaling-stroke"
                      data-a11y-frame
                    />
                  </template>
                </svg>
              </div>
            </div>

            <aside v-if="inspecting" class="flex max-h-[40%] min-h-0 shrink-0 flex-col gap-2 overflow-y-auto border-t border-line p-3 text-xs md:max-h-none md:w-72 md:border-t-0 md:border-l" data-capture-panel>
              <p v-if="dumping" class="flex items-center gap-2 text-ink-muted">
                <LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('deviceTools.inspect.loading') }}
              </p>
              <template v-else-if="nodes">
                <p class="text-2xs text-ink-faint">{{ t('deviceTools.inspect.count', { n: nodes.length }) }}</p>
                <p v-if="!node" class="text-ink-muted">{{ t('deviceTools.inspect.hint') }}</p>
                <template v-else>
                  <nav v-if="crumbs.length > 1" class="flex min-w-0 flex-wrap items-center gap-0.5 text-2xs text-ink-faint" :aria-label="t('deviceTools.inspect.path')">
                    <template v-for="(c, k) in crumbs" :key="c">
                      <span v-if="k" aria-hidden="true">›</span>
                      <button type="button" class="truncate rounded-inner px-1 hover:bg-fill" :class="c === selected ? 'text-accent-ink' : ''" @click="selected = c">{{ shortClass(nodes[c]!.cls) }}</button>
                    </template>
                  </nav>
                  <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1" data-capture-node>
                    <dt class="text-ink-faint">{{ t('deviceTools.inspect.class') }}</dt>
                    <dd class="font-mono break-all">{{ node.cls }}</dd>
                    <template v-if="node.resId">
                      <dt class="text-ink-faint">{{ t('deviceTools.inspect.id') }}</dt>
                      <dd class="font-mono break-all" :title="node.resId">{{ idName(node.resId) }}</dd>
                    </template>
                    <template v-if="node.text">
                      <dt class="text-ink-faint">{{ t('deviceTools.inspect.text') }}</dt>
                      <dd class="break-words">{{ node.text }}</dd>
                    </template>
                    <template v-if="node.desc">
                      <dt class="text-ink-faint">{{ t('deviceTools.inspect.desc') }}</dt>
                      <dd class="break-words">{{ node.desc }}</dd>
                    </template>
                    <dt class="text-ink-faint">{{ t('deviceTools.inspect.bounds') }}</dt>
                    <dd class="font-mono">{{ boundsText(node.bounds) }}</dd>
                  </dl>
                  <div class="flex flex-wrap gap-1.5">
                    <button type="button" class="ccm-btn" :disabled="!query" data-capture-find @click="find">
                      <Search :size="13" aria-hidden="true" />{{ t('deviceTools.inspect.find') }}
                    </button>
                    <button type="button" class="ccm-btn" data-capture-fill @click="fill">
                      <Bot :size="13" aria-hidden="true" />{{ t('deviceTools.inspect.fill') }}
                    </button>
                  </div>
                  <p v-if="!node.resId" class="text-2xs text-ink-faint">{{ t('deviceTools.inspect.flutterHint') }}</p>
                </template>
              </template>
              <p class="mt-auto text-2xs text-ink-faint">{{ t('deviceTools.capture.secureHint') }}</p>
            </aside>

            <aside v-else-if="a11yOn" class="flex max-h-[40%] min-h-0 shrink-0 flex-col gap-2 overflow-y-auto border-t border-line p-3 text-xs md:max-h-none md:w-80 md:border-t-0 md:border-l" data-a11y-panel>
              <p v-if="dumping || (nodes && !report)" class="flex items-center gap-2 text-ink-muted">
                <LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('deviceA11y.loading') }}
              </p>
              <template v-else-if="report">
                <div class="flex items-center gap-2">
                  <p class="mr-auto font-medium" data-a11y-summary>{{ t('deviceA11y.summary', report.findings.length) }}</p>
                  <button type="button" class="ccm-btn" :disabled="!report.findings.length || filling" :title="t('deviceA11y.fillHint')" data-a11y-fill @click="fillA11y">
                    <LoaderCircle v-if="filling" :size="13" class="ccm-spin" aria-hidden="true" />
                    <Bot v-else :size="13" aria-hidden="true" />{{ t(filling ? 'deviceA11y.filling' : 'deviceA11y.fill') }}
                  </button>
                </div>
                <p v-if="!report.findings.length" class="flex items-center gap-1.5 text-success" data-a11y-clean>
                  <CircleCheck :size="13" aria-hidden="true" />{{ t('deviceA11y.clean') }}
                </p>
                <ul v-else class="flex flex-col gap-1" :aria-label="t('deviceA11y.list')" data-a11y-list>
                  <li v-for="(f, k) in report.findings" :key="`${f.node}-${f.kind}`">
                    <button
                      type="button"
                      class="flex w-full items-start gap-1.5 rounded-inner px-1.5 py-1 text-left hover:bg-fill"
                      :class="picked === k ? 'bg-accent-soft' : ''"
                      :aria-pressed="picked === k"
                      :data-a11y-finding="f.kind"
                      @click="picked = picked === k ? -1 : k"
                    >
                      <TriangleAlert :size="13" class="mt-px shrink-0 text-warning" aria-hidden="true" />
                      <span class="min-w-0">
                        <span class="font-medium text-warning">{{ t(`deviceA11y.kind.${f.kind}`) }}</span>
                        <span class="ml-1 font-mono break-all text-ink-muted">{{ nodeRef(nodes![f.node]!) }}</span>
                        <span class="block text-ink-muted">{{ detailOf(f) }}</span>
                      </span>
                    </button>
                    <div v-if="picked === k" class="mt-1 mb-1 flex flex-wrap gap-1.5 pl-6">
                      <button type="button" class="ccm-btn" :disabled="!findingQuery(f)" data-a11y-find @click="findFinding(f)">
                        <Search :size="13" aria-hidden="true" />{{ t('deviceA11y.find') }}
                      </button>
                    </div>
                  </li>
                </ul>
                <p v-if="report.truncated" class="text-2xs text-ink-faint">{{ t('deviceA11y.truncated') }}</p>
                <div class="mt-auto flex flex-col gap-1 pt-2 text-2xs text-ink-faint" data-a11y-notes>
                  <p v-if="dpPx" data-a11y-density>{{ t('deviceA11y.density', { dpi: density, px: dpPx }) }}</p>
                  <p v-else class="text-warning" data-a11y-density-unknown>{{ t('deviceA11y.densityUnknown') }}</p>
                  <p v-if="report.contrast === 'black'" class="text-warning" data-a11y-black>{{ t('deviceA11y.black') }}</p>
                  <p v-else-if="report.contrast === 'no-image'" class="text-warning">{{ t('deviceA11y.noImage') }}</p>
                  <p v-else data-a11y-estimated>{{ t('deviceA11y.estimated') }}</p>
                </div>
              </template>
            </aside>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
