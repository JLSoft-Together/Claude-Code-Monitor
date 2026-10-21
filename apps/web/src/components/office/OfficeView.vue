<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Building2, CircleAlert } from 'lucide-vue-next'
import type { Selection, WorldApi } from '@ccm/habblaud/client/src/world/api'
import { modalOpen } from '@ccm/habblaud/client/src/world/input'
import { useRevealInWorkspace } from '../../composables/useRevealInWorkspace'
import { isTyping } from '../../lib/shortcuts'
import { officeFeed } from '../../office/feed'
import { applyOfficeLocale, type OfficeLocale } from '../../office/i18n'
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

/** Room for the Agent Map toolbar above the canvas (px): overview and focus frame below it. */
const TOOLBAR_INSET = 48
/** Canvas tint while a recorded moment is on screen (upstream `.is-replay`). */
const REPLAY_FILTER = 'sepia(0.3) saturate(0.9) contrast(1.03)'

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const canvasKey = ref(0)
const state = ref<'loading' | 'ready' | 'failed'>('loading')
const counts = ref<{ agents: number; rooms: number } | null>(null)

let gen = 0
/** A build got past the locale and wants snapshots; they flow only while the window is visible too. */
let wantFeed = false
let subscribed = false
let world: WorldApi | null = null
let offSelect: (() => void) | null = null
let offSnapshot: (() => void) | null = null
let roomFocusedFor: string | null = null
let selecting = false

const officeLocale = (l: string): OfficeLocale => (l === 'vi' ? 'vi' : 'en')

function teardown(): void {
  offSelect?.()
  offSnapshot?.()
  offSelect = offSnapshot = null
  world?.destroy()
  world = null
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
  teardown()
  state.value = 'loading'
  try {
    await applyOfficeLocale(officeLocale(locale.value))
    if (my !== gen) return
    officeFeed.relocalize()
    wantFeed = true
    syncFeed()
    const { createWorld } = await import('@ccm/habblaud/client/src/world')
    if (my !== gen) return
    canvasKey.value++
    await nextTick()
    const el = canvas.value
    if (my !== gen || !el) return
    const w: WorldApi = createWorld(el, officeFeed as unknown as Parameters<typeof createWorld>[1])
    world = w
    office.world = w
    w.setOptions({ ...office.options })
    w.setViewInsets?.({ top: TOOLBAR_INSET })
    offSelect = w.onSelect(onWorldSelect)
    // After the world's own listener, so a room is laid out before it is focused.
    offSnapshot = officeFeed.on('snapshot', () => {
      readCounts()
      focusTerminalRoom()
    })
    readCounts()
    state.value = 'ready'
    syncSelection(ui.selectedAgentId)
    focusTerminalRoom()
  } catch {
    if (my !== gen) return
    state.value = 'failed'
    wantFeed = false
    syncFeed()
  }
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
  teardown()
  wantFeed = false
  syncFeed()
})

watch(locale, () => void build())
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
      :key="canvasKey"
      ref="canvas"
      class="absolute inset-0 block h-full w-full [image-rendering:pixelated]"
      :style="office.replaying ? { filter: REPLAY_FILTER } : undefined"
      role="img"
      :aria-label="ariaLabel"
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

    <div v-if="empty" class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4" role="status" aria-live="polite">
      <p class="ccm-menu max-w-full truncate px-3 py-1.5 text-xs text-ink" data-office-empty>{{ t('officeV60.empty') }}</p>
    </div>

    <OfficeTimelapse v-if="office.timelapse" />
  </div>
</template>
