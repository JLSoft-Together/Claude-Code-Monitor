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

function initialCollapsed(): Panel[] {
  try {
    const raw = JSON.parse(localStorage.getItem('ccm.collapsed') ?? '[]')
    return Array.isArray(raw) ? raw.filter((p): p is Panel => p === 'sessions' || p === 'activity') : []
  } catch {
    return []
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
  const layoutRequest = ref(0)
  const collapsed = ref<Panel[]>(initialCollapsed())
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

  watch(collapsed, (value) => {
    try {
      localStorage.setItem('ccm.collapsed', JSON.stringify(value))
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
    return collapsed.value.includes(panel)
  }

  function togglePanel(panel: Panel): void {
    collapsed.value = isCollapsed(panel) ? collapsed.value.filter((p) => p !== panel) : [...collapsed.value, panel]
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

  function focusTerminal(id: string): void {
    focusedTerminalId.value = id
    focusRequest.value++
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
    collapsed,
    isCollapsed,
    togglePanel,
    panelSize,
    setPanelSize,
    savePanelSizes,
    resetPanelSize, selectedAgentId, focusedTerminalId, focusRequest, layoutRequest, setView, selectAgent, focusTerminal, resetLayout,
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
