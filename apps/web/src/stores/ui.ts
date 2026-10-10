import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { FocusWindowResult, OpenApp, OpenResult } from '@ccm/shared'
import type { NodeSize, Point } from '../lib/layout'

export type View = 'monitor' | 'usage' | 'history'
export type Panel = 'sessions' | 'activity'
export type WindowResult = FocusWindowResult | 'offline'

function initialView(): View {
  try {
    const v = localStorage.getItem('ccm.view')
    return v === 'usage' || v === 'history' ? v : 'monitor'
  } catch {
    return 'monitor'
  }
}

// Kept in the URL, not localStorage: a small side window and the main window share storage but not the address.
function initialCompact(): boolean {
  return new URLSearchParams(location.search).get('mode') === 'compact'
}

function initialSessionTab(): string | null {
  try {
    return sessionStorage.getItem('ccm.sessionTab')
  } catch {
    return null
  }
}

export interface PanelState {
  open: boolean
  pinned: boolean
}
export type BarDock = 'top' | 'bottom'

function initialPanels(): Record<Panel, PanelState> {
  const out: Record<Panel, PanelState> = { sessions: { open: true, pinned: true }, activity: { open: false, pinned: false } }
  try {
    const raw = JSON.parse(localStorage.getItem('ccm.panels') ?? 'null') as Record<string, Partial<PanelState>> | null
    if (!raw) {
      // Users of the old grid keep the Sessions column collapsed if they had collapsed it.
      const old: unknown = JSON.parse(localStorage.getItem('ccm.collapsed') ?? '[]')
      if (Array.isArray(old) && old.includes('sessions')) out.sessions.open = false
      return out
    }
    for (const key of ['sessions', 'activity'] as Panel[]) {
      const v = raw[key]
      if (typeof v?.open === 'boolean') out[key].open = v.open
      if (typeof v?.pinned === 'boolean') out[key].pinned = v.pinned
    }
  } catch {
    return out
  }
  return out
}

function initialBar(): { dock: BarDock; min: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem('ccm.bar') ?? '{}') as { dock?: unknown; min?: unknown }
    return { dock: raw.dock === 'top' ? 'top' : 'bottom', min: raw.min === true }
  } catch {
    return { dock: 'bottom', min: false }
  }
}

export type PanelSize = 'sessions' | 'activity' | 'activityHeight'
export const PANEL_DEFAULTS: Record<PanelSize, number> = { sessions: 360, activity: 340, activityHeight: 280 }
export const PANEL_LIMITS: Record<PanelSize, [number, number]> = { sessions: [260, 720], activity: [260, 720], activityHeight: [160, 640] }

export function clampPanel(key: PanelSize, px: number): number {
  const [min, max] = PANEL_LIMITS[key]
  return Math.round(Math.min(max, Math.max(min, px)))
}

function initialSizes(): Record<PanelSize, number> {
  const out = { ...PANEL_DEFAULTS }
  try {
    const raw = JSON.parse(localStorage.getItem('ccm.panelSize') ?? '{}') as Record<string, unknown>
    for (const key of Object.keys(out) as PanelSize[]) {
      const n = raw[key]
      if (typeof n === 'number' && Number.isFinite(n)) out[key] = clampPanel(key, n)
    }
  } catch {
    return out
  }
  return out
}

const MAP_KEY = 'ccm.mapLayout'
const MAP_LIMIT = 300

interface MapLayout {
  sizes: Record<string, NodeSize>
  pos: Record<string, Point>
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function initialMapLayout(): MapLayout {
  const out: MapLayout = { sizes: {}, pos: {} }
  try {
    const raw = JSON.parse(localStorage.getItem(MAP_KEY) ?? '{}') as { sizes?: Record<string, NodeSize>; pos?: Record<string, Point> }
    for (const [id, s] of Object.entries(raw.sizes ?? {})) {
      const size: NodeSize = {}
      if (finite(s?.w)) size.w = s.w
      if (finite(s?.h)) size.h = s.h
      if (size.w !== undefined || size.h !== undefined) out.sizes[id] = size
    }
    for (const [id, p] of Object.entries(raw.pos ?? {})) if (finite(p?.x) && finite(p?.y)) out.pos[id] = { x: p.x, y: p.y }
  } catch {
    return out
  }
  return out
}

// Agent ids are stable per session, so one map entry follows the same node across reloads; oldest entries drop first.
const capped = <T>(rec: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(rec).slice(-MAP_LIMIT))

export const useUiStore = defineStore('ui', () => {
  const savedMap = initialMapLayout()
  const view = ref<View>(initialView())
  const compact = ref(initialCompact())
  const selectedAgentId = ref<string | null>(null)
  const focusedTerminalId = ref<string | null>(null)
  const focusRequest = ref(0)
  const revealRequest = ref(0)
  const activityTerminalId = ref<string | null>(null)
  const sessionTab = ref<string | null>(initialSessionTab())
  watch(sessionTab, (id) => {
    try {
      if (id) sessionStorage.setItem('ccm.sessionTab', id)
      else sessionStorage.removeItem('ccm.sessionTab')
    } catch {
      return
    }
  })
  watch(focusedTerminalId, (id) => {
    if (id && activityTerminalId.value && id !== activityTerminalId.value) activityTerminalId.value = id
  })
  const layoutRequest = ref(0)
  const panels = ref(initialPanels())
  const savedBar = initialBar()
  const barDock = ref<BarDock>(savedBar.dock)
  const barMin = ref(savedBar.min)
  const fitRequest = ref(0)
  const shortcutsOpen = ref(false)
  const keyPress = ref<{ keys: string; n: number } | null>(null)
  const panelSize = ref(initialSizes())
  const nodeSizes = ref<Record<string, NodeSize>>(savedMap.sizes)
  const nodeResized = ref(0)
  // Positions the user set by dragging or by resizing from the north / west edge; layout leaves them alone.
  const nodePos = ref<Record<string, Point>>(savedMap.pos)

  let mapSaveTimer: number | undefined
  watch([nodeSizes, nodePos], () => {
    window.clearTimeout(mapSaveTimer)
    mapSaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(MAP_KEY, JSON.stringify({ sizes: capped(nodeSizes.value), pos: capped(nodePos.value) }))
      } catch {
        return
      }
    }, 400)
  })
  const paletteOpen = ref(false)
  const recapOpen = ref(false)
  const diagnosticsOpen = ref(false)
  const tourOpen = ref(false)
  const settingsOpen = ref(false)
  const breakDue = ref<{ at: number; minutes: number } | null>(null)
  const focusingWindow = ref<string | null>(null)
  const windowResult = ref<{ terminalId: string; result: WindowResult } | null>(null)
  let windowTimer: number | undefined
  const opening = ref<{ terminalId: string; app: OpenApp } | null>(null)
  const openResult = ref<{ terminalId: string; app: OpenApp; result: OpenResult | 'offline' } | null>(null)
  let openTimer: number | undefined

  watch(view, (value) => {
    try {
      localStorage.setItem('ccm.view', value)
    } catch {
      return
    }
  })

  watch(compact, (value) => {
    try {
      const url = new URL(location.href)
      if (value) url.searchParams.set('mode', 'compact')
      else url.searchParams.delete('mode')
      history.replaceState(history.state, '', url)
    } catch {
      return
    }
  })

  watch(
    panels,
    (value) => {
      try {
        localStorage.setItem('ccm.panels', JSON.stringify(value))
      } catch {
        return
      }
    },
    { deep: true },
  )

  watch([barDock, barMin], ([dock, min]) => {
    try {
      localStorage.setItem('ccm.bar', JSON.stringify({ dock, min }))
    } catch {
      return
    }
  })

  function setPanelSize(key: PanelSize, px: number): void {
    panelSize.value = { ...panelSize.value, [key]: clampPanel(key, px) }
  }

  function savePanelSizes(): void {
    try {
      localStorage.setItem('ccm.panelSize', JSON.stringify(panelSize.value))
    } catch {
      return
    }
  }

  function resetPanelSize(key: PanelSize): void {
    setPanelSize(key, PANEL_DEFAULTS[key])
    savePanelSizes()
  }

  function isCollapsed(panel: Panel): boolean {
    return !panels.value[panel].open
  }

  function togglePanel(panel: Panel): void {
    panels.value[panel].open = !panels.value[panel].open
  }

  function togglePanelPin(panel: Panel): void {
    panels.value[panel] = { open: true, pinned: !panels.value[panel].pinned }
  }

  /** Closes panels floating over the map; returns whether any was open. */
  function closeFloating(): boolean {
    let closed = false
    for (const p of Object.values(panels.value)) {
      if (p.open && !p.pinned) {
        p.open = false
        closed = true
      }
    }
    return closed
  }

  function toggleBar(): void {
    barMin.value = !barMin.value
  }

  function toggleBarDock(): void {
    barDock.value = barDock.value === 'top' ? 'bottom' : 'top'
  }

  function requestFit(): void {
    fitRequest.value++
  }

  function pressKey(keys: string): void {
    keyPress.value = { keys, n: (keyPress.value?.n ?? 0) + 1 }
  }

  function setView(value: View): void {
    view.value = value
    compact.value = false
  }

  function toggleCompact(): void {
    compact.value = !compact.value
  }

  function selectAgent(id: string | null): void {
    selectedAgentId.value = id
  }

  function openSessionTab(id: string | null): void {
    sessionTab.value = id
    if (id) focusedTerminalId.value = id
  }

  function focusTerminal(id: string): void {
    if (sessionTab.value !== null) sessionTab.value = id
    focusedTerminalId.value = id
    focusRequest.value++
  }

  function filterActivity(id: string | null): void {
    activityTerminalId.value = id
  }

  function revealTerminal(id: string): void {
    focusedTerminalId.value = id
    revealRequest.value++
  }

  function startWindowFocus(id: string): void {
    focusingWindow.value = id
    windowResult.value = null
    window.clearTimeout(windowTimer)
    // The collector always answers; this only guards against a dropped socket.
    windowTimer = window.setTimeout(() => (focusingWindow.value = null), 10_000)
  }

  function reportWindowResult(id: string, result: WindowResult): void {
    // A late answer for another session must not cancel the guard of the request in flight.
    if (focusingWindow.value !== null && focusingWindow.value !== id) return
    focusingWindow.value = null
    window.clearTimeout(windowTimer)
    windowResult.value = { terminalId: id, result }
    if (result !== 'ok') windowTimer = window.setTimeout(() => (windowResult.value = null), 6_000)
  }

  function startOpen(terminalId: string, app: OpenApp): void {
    opening.value = { terminalId, app }
    openResult.value = null
    window.clearTimeout(openTimer)
    openTimer = window.setTimeout(() => (opening.value = null), 10_000)
  }

  function reportOpenResult(terminalId: string, app: OpenApp, result: OpenResult | 'offline'): void {
    if (opening.value && (opening.value.terminalId !== terminalId || opening.value.app !== app)) return
    opening.value = null
    window.clearTimeout(openTimer)
    openResult.value = result === 'ok' ? null : { terminalId, app, result }
    if (openResult.value) openTimer = window.setTimeout(() => (openResult.value = null), 6_000)
  }

  function openRecap(): void {
    recapOpen.value = true
  }

  function setNodeSize(id: string, size: NodeSize | null): void {
    const next = { ...nodeSizes.value }
    delete next[id]
    if (size) next[id] = size
    nodeSizes.value = next
  }

  function setNodePos(id: string, pos: Point): void {
    const next = { ...nodePos.value }
    delete next[id]
    next[id] = { x: Math.round(pos.x), y: Math.round(pos.y) }
    nodePos.value = next
  }

  function resetLayout(): void {
    nodeSizes.value = {}
    nodePos.value = {}
    layoutRequest.value++
  }

  return {
    view,
    compact,
    toggleCompact,
    panels,
    isCollapsed,
    togglePanel,
    togglePanelPin,
    closeFloating,
    barDock,
    barMin,
    toggleBar,
    toggleBarDock,
    fitRequest,
    requestFit,
    shortcutsOpen,
    keyPress,
    pressKey,
    panelSize,
    setPanelSize,
    savePanelSizes,
    resetPanelSize, selectedAgentId, focusedTerminalId, focusRequest, revealRequest, layoutRequest, setView, selectAgent, focusTerminal, revealTerminal, resetLayout, activityTerminalId, filterActivity, sessionTab, openSessionTab,
    nodeSizes,
    nodeResized,
    setNodeSize,
    nodePos,
    setNodePos,
    paletteOpen,
    opening,
    openResult,
    startOpen,
    reportOpenResult,
    recapOpen,
    diagnosticsOpen,
    tourOpen,
    settingsOpen,
    breakDue,
    openRecap,
    focusingWindow,
    windowResult,
    startWindowFocus,
    reportWindowResult,
  }
})
