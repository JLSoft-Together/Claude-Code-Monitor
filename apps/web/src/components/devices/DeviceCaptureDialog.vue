<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, Camera, CircleAlert, LoaderCircle, Paperclip, RefreshCw, ScanSearch, Search, X } from 'lucide-vue-next'
import type { DevErrorCode, DevUiNode } from '@ccm/shared'
import { useDeviceHandoff } from '../../composables/useDeviceHandoff'
import { boundsText, hasArea, idName, nodeAt, nodePrompt, nodeSearch, pathTo, shortClass } from '../../lib/deviceInspect'
import { devScreencap, devUiDump } from '../../lib/devices'
import { retireOverlay } from '../../lib/motion'

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
const dumping = ref(false)
const nodes = ref<DevUiNode[] | null>(null)
const selected = ref(-1)
const hovered = ref(-1)
const fit = ref({ w: 0, h: 0 })
let gen = 0
let restoreFocus: HTMLElement | null = null

const errorText = computed(() => {
  const code = error.value?.code
  if (!code) return ''
  return t(te(`devices.error.${code}`) ? `devices.error.${code}` : 'devices.error.denied')
})
const boxes = computed(() => (nodes.value ?? []).map((n, i) => ({ n, i })).filter(({ n }) => hasArea(n)))
const node = computed(() => (selected.value >= 0 ? (nodes.value?.[selected.value] ?? null) : null))
const crumbs = computed(() => (nodes.value && selected.value >= 0 ? pathTo(nodes.value, selected.value).slice(-4) : []))
const query = computed(() => (node.value ? nodeSearch(node.value) : null))

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
  try {
    const r = await devScreencap(id)
    if (my !== gen) return
    if (r.ok) shot.value = { png: r.png, width: r.width, height: r.height }
    else error.value = { code: r.error, detail: r.detail }
  } finally {
    if (my === gen) capturing.value = false
  }
  if (my === gen && shot.value && inspecting.value) await dump()
}

async function dump(): Promise<void> {
  const id = props.deviceId
  if (!id) return
  const my = gen
  dumping.value = true
  try {
    const r = await devUiDump(id)
    if (my !== gen) return
    if (r.ok) nodes.value = r.nodes
    else error.value = { code: r.error, detail: r.detail }
  } finally {
    if (my === gen) dumping.value = false
  }
}

function toggleInspect(): void {
  inspecting.value = !inspecting.value
  if (inspecting.value && !nodes.value && shot.value) void dump()
}

function pointAt(e: MouseEvent): number {
  const s = shot.value
  const el = e.currentTarget as SVGElement
  if (!s || !nodes.value) return -1
  const r = el.getBoundingClientRect()
  return nodeAt(nodes.value, ((e.clientX - r.left) / r.width) * s.width, ((e.clientY - r.top) / r.height) * s.height)
}

function onPick(e: MouseEvent): void {
  if (!inspecting.value) return
  selected.value = pointAt(e)
  note.value = selected.value < 0 ? { text: t('deviceTools.inspect.none'), warn: false } : null
}

async function attach(): Promise<void> {
  if (!shot.value) return
  const r = await handoff.attachImage(shot.value.png, `${props.deviceName.replace(/[^\w.-]+/g, '-')}.png`)
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
      void capture()
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('[data-capture-close]')?.focus()
    } else {
      gen++
      observer?.disconnect()
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => observer?.disconnect())
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
                  v-if="inspecting && nodes"
                  class="absolute inset-0 size-full cursor-crosshair"
                  :viewBox="`0 0 ${shot.width} ${shot.height}`"
                  preserveAspectRatio="none"
                  data-capture-overlay
                  @mousemove="hovered = pointAt($event)"
                  @mouseleave="hovered = -1"
                  @click="onPick"
                >
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
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
