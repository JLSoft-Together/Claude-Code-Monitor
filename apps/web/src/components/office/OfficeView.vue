<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Building2, CircleAlert, LoaderCircle } from 'lucide-vue-next'
import type { Selection, WorldApi } from '@ccm/habblaud/client/src/world/api'
import { modalOpen } from '@ccm/habblaud/client/src/world/input'
import { useRevealInWorkspace } from '../../composables/useRevealInWorkspace'
import { isTyping } from '../../lib/shortcuts'
import { officeFeed } from '../../office/feed'
import { applyOfficeLocale, type OfficeLocale } from '../../office/i18n'
import { CLASSIC_PACK, loadOfficePack } from '../../office/packs'
import { loadIso, lookFromAgents, markIsoUsed, settleWithin, type IsoKit, type OfficeStyle } from '../../office/iso'
import { scheduleIsoPreload, warmIsoArt } from '../../office/iso/preload'
import { ISO_RELEASE_MS, LAYER_FADE_MS, READY_MAX_MS, SWITCH_ERROR_MS, SWITCH_OVERLAY_DELAY_MS, WARM_UP_MS, WORLD_ASSETS_WAIT_MS } from '../../office/switching'
import { setRoomThemes } from '@ccm/habblaud/client/src/art/theme'
import { loadWorldAssets, type WorldAssets } from '@ccm/habblaud/client/src/world/assets'
import { useAgentsStore } from '../../stores/agents'
import { useConnectionStore } from '../../stores/connection'
import { officeRoomOf, useOfficeStore } from '../../stores/office'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import OfficeTimelapse from './OfficeTimelapse.vue'

const props = defineProps<{ terminalId?: string | null }>()

const { t, locale } = useI18n()
const ui = useUiStore()
const agents = useAgentsStore()
const connection = useConnectionStore()
const settings = useSettingsStore()
const office = useOfficeStore()
const reveal = useRevealInWorkspace()

const FULLSCREEN_FIT_MS = 120
/** Room for the Agent Map toolbar above the canvas (px): overview and focus frame below it. */
const TOOLBAR_INSET = 48
/** Canvas tint while a recorded moment is on screen (upstream `.is-replay`). */
const REPLAY_FILTER = 'sepia(0.3) saturate(0.9) contrast(1.03)'

interface Layer {
  key: number
  style: OfficeStyle
  shown: boolean
}

interface Pending {
  world: WorldApi | null
  layer: Layer
  offReady: (() => void) | null
  release: (() => void) | null
}

const root = ref<HTMLElement | null>(null)
const layers = ref<Layer[]>([])
const canvasEls = new Map<number, HTMLCanvasElement>()
const state = ref<'loading' | 'ready' | 'failed'>('loading')
const counts = ref<{ agents: number; rooms: number } | null>(null)
const overlay = ref(false)
const switchTo = ref<OfficeStyle>('pixel')

let gen = 0
/** A build got past the locale and wants snapshots; they flow only while the window is visible too. */
let wantFeed = false
let subscribed = false
let world: WorldApi | null = null
let offSelect: (() => void) | null = null
let offSnapshot: (() => void) | null = null
let roomFocusedFor: string | null = null
let uninstallPersonas: (() => void) | null = null
let selecting = false
let layerSeq = 0
let pending: Pending | null = null
let shownSig: string | null = null
let overlayTimer: ReturnType<typeof setTimeout> | null = null
let shownStyle: OfficeStyle | null = null
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let errorTimer: ReturnType<typeof setTimeout> | null = null

function clearRelease(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
}

function armRelease(): void {
  clearRelease()
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    if (shownStyle !== 'pixel' || pending || office.style !== 'pixel') return
    void import('../../office/iso/isoArt').then((m) => m.releaseIsoArt())
  }, ISO_RELEASE_MS)
}

function showSwitchError(style: OfficeStyle): void {
  office.switchError = style
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => {
    errorTimer = null
    office.switchError = null
  }, SWITCH_ERROR_MS)
}
const retireTimers = new Set<ReturnType<typeof setTimeout>>()

function setCanvas(key: number, el: unknown): void {
  if (el instanceof HTMLCanvasElement) canvasEls.set(key, el)
  else canvasEls.delete(key)
}

function removeLayer(key: number): void {
  layers.value = layers.value.filter((l) => l.key !== key)
  canvasEls.delete(key)
}

function retireOthers(keep: number): void {
  const old = layers.value.filter((l) => l.key !== keep).map((l) => l.key)
  if (!old.length) return
  const timer = setTimeout(() => {
    retireTimers.delete(timer)
    for (const k of old) removeLayer(k)
  }, LAYER_FADE_MS)
  retireTimers.add(timer)
}

function beginSwitching(to: OfficeStyle): void {
  switchTo.value = to
  office.switching = true
  if (overlayTimer) return
  overlayTimer = setTimeout(() => {
    overlayTimer = null
    if (office.switching) overlay.value = true
  }, SWITCH_OVERLAY_DELAY_MS)
}

function endSwitching(): void {
  if (overlayTimer) clearTimeout(overlayTimer)
  overlayTimer = null
  office.switching = false
  overlay.value = false
}

function cancelPending(): void {
  const p = pending
  if (!p) return
  pending = null
  p.offReady?.()
  p.world?.destroy()
  removeLayer(p.layer.key)
  p.release?.()
}

function whenReady(p: Pending, w: WorldApi): Promise<void> {
  if (typeof w.onReady !== 'function') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, READY_MAX_MS)
    function done(): void {
      clearTimeout(timer)
      p.release = null
      resolve()
    }
    p.release = done
    p.offReady = w.onReady!(done)
  })
}

function worldAssets(pack: string | undefined): Promise<WorldAssets | null | undefined> {
  return settleWithin(
    loadWorldAssets(undefined, { pack }).then((a) => ({ a })),
    WORLD_ASSETS_WAIT_MS,
  ).then((r) => (r ? r.a : undefined))
}

const officeLocale = (l: string): OfficeLocale => (l === 'vi' ? 'vi' : 'en')

function teardown(): void {
  offSelect?.()
  offSnapshot?.()
  offSelect = offSnapshot = null
  world?.destroy()
  world = null
  uninstallPersonas?.()
  uninstallPersonas = null
  office.world = null
  roomFocusedFor = null
}

function syncFeed(): void {
  const on = wantFeed && !document.hidden
  if (on === subscribed) return
  subscribed = on
  connection.subscribeOffice(on)
}

function readCounts(): void {
  const s = officeFeed.snapshot
  counts.value = s ? { agents: s.agents.length, rooms: s.rooms.length } : null
}

function focusTerminalRoom(): void {
  const tid = props.terminalId
  if (!world || !tid || roomFocusedFor === tid) return
  const room = officeRoomOf(officeFeed.snapshot, agents.mainOf(tid)?.id)
  if (!room) return
  roomFocusedFor = tid
  world.focusRoom(room)
}

function onWorldSelect(sel: Selection): void {
  if (selecting || sel?.type !== 'agent') return
  if (ui.selectedAgentId !== sel.id) ui.selectAgent(sel.id)
  const tid = agents.byId[sel.id]?.terminalId
  if (!tid) return
  ui.revealTerminal(tid)
  jumpIfAsking(sel.id, tid)
}

/** A raised hand on screen: go to its session (Workspace pane, else its terminal window). Focus only, nothing is sent. */
function jumpIfAsking(agentId: string, terminalId: string): void {
  if (officeFeed.replaying) return
  if (officeFeed.snapshot?.agents.find((a) => a.id === agentId)?.status !== 'waiting') return
  if (reveal.show(terminalId)) return
  if (!connection.focusWindow(terminalId)) ui.reportWindowResult(terminalId, 'offline')
}

function syncSelection(id: string | null): void {
  if (!world) return
  const cur = world.getSelection()
  if (id ? cur?.type === 'agent' && cur.id === id : cur?.type !== 'agent') return
  selecting = true
  try {
    world.select(id ? { type: 'agent', id } : null, { focus: !!id })
  } finally {
    selecting = false
  }
}

/** Mount and language switch: locale first (world modules read `tr()` at load), then subscribe, import, create. */
async function build(): Promise<void> {
  const my = ++gen
  cancelPending()
  const want = office.style
  const sig = `${want}|${locale.value}|${office.pack}`
  if (world && sig === shownSig) {
    endSwitching()
    return
  }
  clearRelease()
  if (world) beginSwitching(want)
  else state.value = 'loading'
  try {
    await applyOfficeLocale(officeLocale(locale.value))
    if (my !== gen) return
    officeFeed.relocalize()
    wantFeed = true
    syncFeed()
    await office.loadPacks()
    if (my !== gen) return
    const pack = await loadOfficePack(office.activePack)
    if (my !== gen) return
    setRoomThemes(pack.rooms)
    office.packMissing = office.pack !== CLASSIC_PACK && !pack.rooms ? office.pack : null
    const [iso, assets] = await Promise.all([loadIso(want).catch((e: unknown): IsoKit | null => {
        if (world) throw e
        return null
      }), worldAssets(pack.assetPack)])
    if (my !== gen) return
    const { createWorld } = await import('@ccm/habblaud/client/src/world')
    if (my !== gen) return
    const layer: Layer = { key: ++layerSeq, style: iso ? 'iso' : 'pixel', shown: false }
    layers.value = [...layers.value, layer]
    const p: Pending = { world: null, layer, offReady: null, release: null }
    pending = p
    await nextTick()
    const el = canvasEls.get(layer.key)
    if (my !== gen || pending !== p) return
    if (!el) throw new Error('office canvas missing')
    const base = assets === undefined ? { assetPack: pack.assetPack } : { assetPack: pack.assetPack, assets }
    const opts = iso ? { ...base, projection: iso.projection, renderer: iso.createRenderer, maxZoom: iso.maxZoom, text: iso.text, warmUpMs: WARM_UP_MS } : { ...base, warmUpMs: WARM_UP_MS }
    const w: WorldApi = createWorld(el, officeFeed as unknown as Parameters<typeof createWorld>[1], opts)
    p.world = w
    w.setOptions({ ...office.options })
    w.setViewInsets?.({ top: TOOLBAR_INSET })
    if (office.fullscreen) w.overview({ fill: true })
    await whenReady(p, w)
    if (my !== gen || pending !== p) return
    promote(p, w, iso, my, sig)
  } catch {
    if (my !== gen) return
    cancelPending()
    if (world) {
      endSwitching()
      if (shownStyle && office.style !== shownStyle) {
        showSwitchError(office.style)
        office.setStyle(shownStyle)
      }
      return
    }
    state.value = 'failed'
    wantFeed = false
    syncFeed()
  }
}

function promote(p: Pending, w: WorldApi, iso: IsoKit | null, my: number, sig: string): void {
  pending = null
  p.offReady?.()
  teardown()
  world = w
  office.world = w
  const layer = layers.value.find((l) => l.key === p.layer.key)
  if (layer) layer.shown = true
  retireOthers(p.layer.key)
  if (iso) uninstallPersonas = iso.installPersonas(lookFromAgents(() => officeFeed.snapshot?.agents))
  office.isoArtMissing = false
  if (iso)
    void iso.art.then(
      (a) => {
        if (my === gen) office.isoArtMissing = a.missing
      },
      () => {
        if (my === gen) office.isoArtMissing = true
      },
    )
  w.setOptions({ ...office.options })
  offSelect = w.onSelect(onWorldSelect)
  // After the world's own listener, so a room is laid out before it is focused.
  offSnapshot = officeFeed.on('snapshot', () => {
    readCounts()
    focusTerminalRoom()
  })
  readCounts()
  state.value = 'ready'
  shownSig = sig
  shownStyle = iso ? 'iso' : 'pixel'
  endSwitching()
  if (iso) markIsoUsed()
  else armRelease()
  syncSelection(ui.selectedAgentId)
  focusTerminalRoom()
  if (!iso && office.style === 'pixel') scheduleIsoPreload()
}

/** Key L toggles the timelapse while the office is on screen, unless a field, a dialog or a modifier owns the key. */
function onKey(e: KeyboardEvent): void {
  if (e.code !== 'KeyL' || e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  if (isTyping(e.target) || modalOpen(e.target instanceof HTMLElement ? e.target : null)) return
  if (ui.paletteOpen || ui.settingsOpen || ui.tourOpen || ui.recapOpen || ui.diagnosticsOpen || ui.shortcutsOpen) return
  if (!office.timelapse && !world) return
  e.preventDefault()
  office.toggleTimelapse()
  ui.pressKey('L')
}

/** The world's camera keys (vendored `input.ts`, on window). */
const CAMERA_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S', '+', '=', '-', '_', '0'])

/**
 * Keeps those keys for the office: from focus in a side panel they would pan the camera and their preventDefault
 * would block the panel's keyboard scrolling. Registered on window before any world, so it stops only the window
 * listeners that come after it (the world's); document listeners (Monitor shortcuts, key L) already ran.
 */
function guardCameraKeys(e: KeyboardEvent): void {
  if (!CAMERA_KEYS.has(e.key)) return
  const t = e.target
  if (t === document.body || t === document.documentElement || t === document || t === window) return
  // The map region: office canvas, timelapse bar and the Agent Map toolbar above them.
  const area = root.value?.parentElement ?? root.value
  if (t instanceof Node && area?.contains(t)) return
  e.stopImmediatePropagation()
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', syncFeed)
  window.addEventListener('keydown', guardCameraKeys)
  void build()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', syncFeed)
  window.removeEventListener('keydown', guardCameraKeys)
  // The timelapse child unmounts next and ends any replay; the bar starts closed on the next visit.
  office.timelapse = false
  gen++
  cancelPending()
  teardown()
  endSwitching()
  for (const t of retireTimers) clearTimeout(t)
  retireTimers.clear()
  shownSig = null
  shownStyle = null
  clearRelease()
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = null
  office.switchError = null
  wantFeed = false
  syncFeed()
})

watch(locale, () => void build())
watch(
  () => office.pack,
  () => void build(),
)
watch(
  () => office.style,
  () => void build(),
)
watch(
  () => office.isoIntent,
  () => {
    if (shownStyle !== 'pixel' || pending) return
    void warmIsoArt()
    armRelease()
  },
)
// Theme tokens give the account colours; the world itself keeps Habblaud's palette.
watch(
  () => settings.theme,
  () => officeFeed.relocalize(),
  { flush: 'post' },
)
watch(
  () => ui.selectedAgentId,
  (id) => syncSelection(id),
)
watch(
  () => props.terminalId,
  () => {
    roomFocusedFor = null
    focusTerminalRoom()
  },
)
watch(
  () => ui.fitRequest,
  () => world?.overview(),
)
let fullscreenFit: ReturnType<typeof setTimeout> | undefined
watch(
  () => office.fullscreen,
  (fill) => {
    clearTimeout(fullscreenFit)
    fullscreenFit = setTimeout(() => world?.overview({ fill }), FULLSCREEN_FIT_MS)
  },
)
onBeforeUnmount(() => clearTimeout(fullscreenFit))

const ariaLabel = computed(() => {
  const c = counts.value ?? { agents: 0, rooms: 0 }
  return t('officeV60.ariaLabel', { agents: t('officeV60.agents', { n: c.agents }, c.agents), rooms: t('officeV60.rooms', { n: c.rooms }, c.rooms) })
})
const empty = computed(() => state.value === 'ready' && counts.value?.agents === 0 && !office.timelapse)
const waiting = computed(() => state.value === 'loading' || (state.value === 'ready' && !counts.value))
</script>

<template>
  <div ref="root" class="relative h-full w-full min-w-0 overflow-hidden bg-canvas" data-office>
    <canvas
      v-for="l in layers"
      :key="l.key"
      :ref="(el) => setCanvas(l.key, el)"
      class="absolute inset-0 block h-full w-full transition-opacity duration-(--ccm-dur-base) ease-out-quint motion-reduce:duration-(--ccm-dur-fast)"
      :class="[l.style === 'pixel' ? '[image-rendering:pixelated]' : '', l.shown ? 'opacity-100' : 'pointer-events-none opacity-0']"
      :data-office-style="l.style"
      :data-office-layer="l.shown ? 'live' : 'pending'"
      :style="office.replaying ? { filter: REPLAY_FILTER } : undefined"
      :role="l.shown ? 'img' : undefined"
      :aria-label="l.shown ? ariaLabel : undefined"
      :aria-hidden="l.shown ? undefined : 'true'"
    />

    <div
      v-if="waiting || state === 'failed'"
      class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-ink-muted"
      role="status"
      aria-live="polite"
      data-office-state
    >
      <template v-if="state === 'failed'">
        <CircleAlert :size="28" class="text-st-error" aria-hidden="true" />
        <p>{{ t('officeV60.failed') }}</p>
      </template>
      <template v-else>
        <Building2 :size="28" class="text-ink-faint" aria-hidden="true" />
        <p>{{ t('officeV60.loading') }}</p>
      </template>
    </div>

    <Transition name="ccm-fade">
      <div v-if="overlay" class="pointer-events-none absolute inset-0 flex items-center justify-center px-6" role="status" aria-live="polite" data-office-switching>
        <p class="ccm-menu flex max-w-full items-center gap-2 px-3 py-1.5 text-xs text-ink">
          <LoaderCircle :size="14" class="shrink-0 animate-spin text-ink-muted" aria-hidden="true" />
          <span class="truncate">{{ t(`officeV63.switching.${switchTo}`) }}</span>
        </p>
      </div>
    </Transition>

    <Transition name="ccm-fade">
      <div v-if="office.switchError" class="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-4" role="alert" data-office-switch-error>
        <p class="ccm-menu flex max-w-full items-center gap-2 px-3 py-1.5 text-xs text-ink">
          <CircleAlert :size="14" class="shrink-0 text-st-error" aria-hidden="true" />
          <span class="truncate">{{ t(`officeV63.switchFailed.${office.switchError}`) }}</span>
        </p>
      </div>
    </Transition>

    <div v-if="empty" class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4" role="status" aria-live="polite">
      <p class="ccm-menu max-w-full truncate px-3 py-1.5 text-xs text-ink" data-office-empty>{{ t('officeV60.empty') }}</p>
    </div>

    <OfficeTimelapse v-if="office.timelapse" />
  </div>
</template>
