import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { FocusWindowResult } from '@ccm/shared'
import type { NodeSize } from '../lib/layout'

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

export const useUiStore = defineStore('ui', () => {
  const view = ref<View>(initialView())
  const selectedAgentId = ref<string | null>(null)
  const focusedTerminalId = ref<string | null>(null)
  const focusRequest = ref(0)
  const layoutRequest = ref(0)
  const collapsed = ref<Panel[]>(initialCollapsed())
  const panelSize = ref(initialSizes())
  const nodeSizes = ref<Record<string, NodeSize>>({})
  const nodeResized = ref(0)
  const paletteOpen = ref(false)
  const recapOpen = ref(false)
  const focusingWindow = ref<string | null>(null)
  const windowResult = ref<{ terminalId: string; result: WindowResult } | null>(null)
  let windowTimer: number | undefined

  watch(view, (value) => {
    try {
      localStorage.setItem('ccm.view', value)
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

  function openRecap(): void {
    recapOpen.value = true
  }

  function setNodeSize(id: string, size: NodeSize | null): void {
    const next = { ...nodeSizes.value }
    if (size) next[id] = size
    else delete next[id]
    nodeSizes.value = next
  }

  function resetLayout(): void {
    nodeSizes.value = {}
    layoutRequest.value++
  }

  return {
    view,
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
    paletteOpen,
    recapOpen,
    openRecap,
    focusingWindow,
    windowResult,
    startWindowFocus,
    reportWindowResult,
  }
})
