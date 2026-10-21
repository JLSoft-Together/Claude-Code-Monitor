<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, useVueFlow, type Edge, type GraphNode, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Building2,
  ChartGantt,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  History,
  LayoutGrid,
  Mail,
  Maximize,
  Volume1,
  Volume2,
  VolumeX,
  Minus,
  Network,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  X,
} from 'lucide-vue-next'
import type { Agent, PeerLink } from '@ccm/shared'
import { useAgentsStore } from '../stores/agents'
import { useConnectionStore } from '../stores/connection'
import { otherEnd, peerLinkId, usePeersStore, type PeerPulse } from '../stores/peers'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore, type MapView } from '../stores/ui'
import { useAgentActions } from '../composables/useAgentActions'
import { MAP_RUNNERS, PEER_MAP, usePeerName, type PeerEdgeData, type PeerLane, type PeerMapContext, type RunnerBudget } from '../composables/useMapNode'
import { useRevealInWorkspace } from '../composables/useRevealInWorkspace'
import { dustOutAll } from '../lib/dust'
import { isFinished, MAIN_HEIGHT, MAIN_WIDTH, peerPath, peerSlots, pickLayout, trayId, trayTerminal, treeOrder, visibleAgents, type Box, type Point } from '../lib/layout'
import { canvasMenu, nodeMenu, peerTarget, type CanvasAction, type NodeAction } from '../lib/mapMenu'
import { buildNav, childCounts, hideCollapsed, navigate, NAV_KEYS, treeParent, type MapNav, type MapNodeContext, type NavKey, type TrayState } from '../lib/mapNav'
import { agentName, searchText } from '../lib/mapText'
import type { MenuEntry } from '../lib/menu'
import { motionMs, nextMapIsSwitch, reducedMotion } from '../lib/motion'
import { isMac } from '../lib/platform'
import { isTyping, keyCombo } from '../lib/shortcuts'
import { WINDOWS } from '../lib/toolTimeline'
import AgentDetails from './AgentDetails.vue'
import ContextMenu from './ui/ContextMenu.vue'
import DoneTray from './DoneTray.vue'
import MainNode from './MainNode.vue'
import PeerEdge from './PeerEdge.vue'
import SubPill from './SubPill.vue'
import TreeEdge from './TreeEdge.vue'
import KeyHint from './KeyHint.vue'
import SegmentedControl from './ui/SegmentedControl.vue'
import ToolTimeline from './ToolTimeline.vue'
import OfficeOptions from './office/OfficeOptions.vue'
import OfficeView from './office/OfficeView.vue'
import { useOfficeStore } from '../stores/office'

const props = defineProps<{ terminalId?: string | null }>()
const { t } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()

const scoped = !!props.terminalId
const FLOW_ID = scoped ? `agent-map-${props.terminalId}` : 'agent-map'
const {
  addNodes,
  removeNodes,
  getNodes,
  findNode,
  fitView,
  getViewport,
  setViewport,
  setCenter,
  zoomIn,
  zoomOut,
  updateNode,
  onNodeClick,
  onNodeContextMenu,
  onNodeDragStop,
  onPaneClick,
  onPaneContextMenu,
  onNodesInitialized,
  viewport,
  dimensions,
} = useVueFlow(FLOW_ID)
const reveal = useRevealInWorkspace()

const canvas = ref<HTMLElement | null>(null)
const picked = ref<Set<string>>(new Set())
const hasNodes = ref(false)
let didInitialFit = false
let pendingFit = false
const flyIn = nextMapIsSwitch()

const highlighted = computed(() => (ui.selectedAgentId ? agents.lineage(ui.selectedAgentId) : null))
provide('ccm-highlight', highlighted)

const source = computed(() => (props.terminalId ? (agents.byTerminal[props.terminalId] ?? []) : agents.list))
const sourceByTerminal = computed(() => {
  const out: Record<string, Agent[]> = {}
  for (const a of source.value) (out[a.terminalId] ??= []).push(a)
  return out
})

const LINGER_MS = 1400
const lingering = ref<ReadonlySet<string>>(new Set())
const lingerTimers = new Map<string, number>()
function linger(id: string): void {
  if (!motionMs(LINGER_MS)) return
  window.clearTimeout(lingerTimers.get(id))
  lingering.value = new Set([...lingering.value, id])
  lingerTimers.set(
    id,
    window.setTimeout(() => {
      lingerTimers.delete(id)
      const next = new Set(lingering.value)
      next.delete(id)
      lingering.value = next
    }, LINGER_MS),
  )
}

const byCompletion = (a: Agent, b: Agent) => (a.completedAt ?? a.updatedAt ?? '').localeCompare(b.completedAt ?? b.updatedAt ?? '')

const finished = computed(() => {
  const visible = new Set<string>()
  const trays: Record<string, TrayState> = {}
  for (const [tid, list] of Object.entries(sourceByTerminal.value)) {
    const open = ui.openTrays.has(tid)
    for (const id of visibleAgents(list, !open).visible) visible.add(id)
    if (!open) {
      for (const id of lingering.value) {
        let cur: Agent | undefined = agents.byId[id]
        while (cur && cur.terminalId === tid && !visible.has(cur.id)) {
          visible.add(cur.id)
          cur = cur.parentId ? agents.byId[cur.parentId] : undefined
        }
      }
    }
    const done = list.filter(isFinished).sort(byCompletion)
    if (done.length) trays[tid] = { open, finished: done, hidden: done.filter((a) => !visible.has(a.id)) }
  }
  return { visible, trays }
})
const trays = computed(() => finished.value.trays)
provide('ccm-map-trays', trays)
const hiddenTotal = computed(() => Object.values(trays.value).reduce((n, s) => n + s.hidden.length, 0))
const allTraysOpen = computed(() => {
  const ids = Object.keys(trays.value)
  return ids.length > 0 && ids.every((tid) => ui.openTrays.has(tid))
})
function toggleAllTrays(): void {
  ui.setOpenTrays(allTraysOpen.value ? [] : Object.keys(trays.value))
  void nextTick(() => ui.requestFit())
}

// Text copies and find walk this list: folded subtrees still count, hidden finished subagents do not.
const finishedList = computed(() => source.value.filter((a) => finished.value.visible.has(a.id)))
const folding = computed(() => hideCollapsed(finishedList.value, ui.collapsedAgents))
const childMap = computed(() => childCounts(finishedList.value))
const visibility = computed(() => ({ visible: folding.value.visible }))
const shownList = computed(() => source.value.filter((a) => visibility.value.visible.has(a.id)))
const shownByTerminal = computed(() => {
  const out: Record<string, typeof agents.list> = {}
  for (const [id, list] of Object.entries(agents.byTerminal)) {
    if (props.terminalId && id !== props.terminalId) continue
    const kept = list.filter((a) => visibility.value.visible.has(a.id))
    if (kept.length) out[id] = kept
  }
  return out
})
const trayIds = computed(() =>
  Object.entries(trays.value)
    .filter(([tid, s]) => {
      const main = shownByTerminal.value[tid]?.find((a) => a.role === 'main')
      return !!main && !ui.collapsedAgents.has(main.id) && (s.open ? s.finished.length : s.hidden.length) > 0
    })
    .map(([tid]) => tid),
)

const edgeParent = computed(() => {
  const out = new Map<string, string>()
  for (const list of Object.values(shownByTerminal.value)) {
    const ids = new Set(list.map((a) => a.id))
    const main = list.find((a) => a.role === 'main')
    for (const a of list) {
      const p = treeParent(a, ids, main?.id)
      if (p) out.set(a.id, p)
    }
  }
  return out
})

type Pulse = { n: number; dir: 'down' | 'up' }
const pulses = ref<Record<string, Pulse>>({})
let pulseSeq = 0
function pulse(edgeId: string, dir: Pulse['dir']): void {
  pulses.value = { ...pulses.value, [edgeId]: { n: ++pulseSeq, dir } }
}

const HANDBACK_MS = 60_000
const SAME_UP_MS = 1500
const handedBack = new Map<string, number>()
const upAt = new Map<string, number>()

let lastStatus = new Map<string, string>()
watch(
  () => source.value.filter((a) => a.role !== 'main').map((a) => `${a.id}\u0000${a.status}`),
  (rows) => {
    const next = new Map(rows.map((r) => r.split('\u0000') as [string, string]))
    for (const [id, status] of next) {
      const prev = lastStatus.get(id)
      if (!prev || prev === status || prev === 'completed' || prev === 'cancelled') continue
      if (status !== 'completed' && status !== 'cancelled') continue
      const parent = edgeParent.value.get(id)
      const handed = performance.now() - (handedBack.get(id) ?? -Infinity) < HANDBACK_MS
      if (parent && !handed) {
        upAt.set(id, performance.now())
        pulse(`${parent}->${id}`, 'up')
      }
      linger(id)
    }
    lastStatus = next
  },
  { immediate: true },
)

const terminalOrder = computed(() =>
  [...terminals.list].filter((x) => !props.terminalId || x.id === props.terminalId).sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.id.localeCompare(b.id)),
)

const structureKey = computed(() =>
  [
    terminalOrder.value.map((x) => x.id).join(','),
    shownList.value
      .map((a) => `${a.id}>${a.parentId ?? ''}@${a.terminalId}:${a.startedAt ?? ''}`)
      .sort()
      .join('|'),
    trayIds.value.join(','),
  ].join('#'),
)

const FIT_TOP = 64
const FIT_PADDING = { top: `${FIT_TOP}px`, bottom: '28px', x: '36px' } as const
const FOCUS_PADDING = { top: '72px', bottom: '12%', x: '12%' } as const
const GLYPH = { x: 19, y: 15 }
const DOT = { x: 16, y: 14, step: 12, max: 11 }
let perRow: number | undefined
let lastPlaced = new Map<string, Point>()
const openedTrays = new Set<string>()

watch(
  () => ui.openTrays,
  (now, before) => {
    for (const tid of now) if (!before?.has(tid)) openedTrays.add(tid)
  },
)

function trayDot(tid: string, placed: Map<string, Point>): Point | null {
  const tray = placed.get(trayId(tid))
  if (!tray) return null
  const n = Math.max(0, Math.min((trays.value[tid]?.hidden.length ?? 0) - 1, DOT.max))
  return { x: tray.x + DOT.x + n * DOT.step, y: tray.y + DOT.y }
}

function offsetFrom(from: Point, to: Point): Record<string, string> {
  return { '--ccm-to-x': `${Math.round(to.x - from.x - GLYPH.x)}px`, '--ccm-to-y': `${Math.round(to.y - from.y - GLYPH.y)}px` }
}

function syncNodes(fit = false): void {
  const box = canvas.value
  const terminalIds = terminalOrder.value.map((x) => x.id)
  const picked = pickLayout(
    {
      terminals: terminalIds,
      agentsByTerminal: shownByTerminal.value,
      trays: Object.fromEntries(trayIds.value.map((tid) => [tid, true])),
      sizes: ui.nodeSizes,
    },
    { width: box?.clientWidth || 900, height: box?.clientHeight || 600 },
    perRow,
  )
  perRow = picked.perRow
  const placed = picked.result.positions
  if (!scoped) {
    for (const tid of terminalIds) {
      const list = shownByTerminal.value[tid]
      const main = list?.find((a) => a.role === 'main')
      const saved = main ? ui.nodePos[main.id] : undefined
      const at = main ? placed.get(main.id) : undefined
      if (!list || !saved || !at) continue
      const dx = saved.x - at.x
      const dy = saved.y - at.y
      for (const id of [...list.map((a) => a.id), trayId(tid)]) {
        const p = placed.get(id)
        if (p) placed.set(id, { x: p.x + dx, y: p.y + dy })
      }
    }
  }
  lastPlaced = placed
  const wanted = new Map<string, Node>()
  for (const a of shownList.value) wanted.set(a.id, { id: a.id, type: a.role === 'main' ? 'main' : 'sub', position: { x: 0, y: 0 }, data: { agentId: a.id }, draggable: true, selectable: false })
  for (const tid of trayIds.value) wanted.set(trayId(tid), { id: trayId(tid), type: 'tray', position: { x: 0, y: 0 }, data: { terminalId: tid }, draggable: false, selectable: false })
  const current = new Map(getNodes.value.map((n) => [n.id, n]))

  retireNodes(
    [...current.keys()].filter((id) => !wanted.has(id)),
    placed,
  )

  const fresh: Node[] = []
  for (const [id, spec] of wanted) {
    const position = (scoped || spec.type === 'tray' ? undefined : ui.nodePos[id]) ?? placed.get(id)
    if (!position) continue
    const node = current.get(id)
    if (node && leaving.has(id)) keepNode(id)
    if (!node) {
      const agent = agents.byId[id]
      const from = agent && isFinished(agent) && openedTrays.has(agent.terminalId) ? trayDot(agent.terminalId, placed) : null
      if (from && motionMs(1)) {
        fresh.push({ ...spec, position: { ...position }, class: 'ccm-node-from-tray', style: offsetFrom(position, from) })
        window.setTimeout(() => findNode(id) && !leaving.has(id) && updateNode(id, { class: '', style: {} }), FROM_TRAY_MS)
      } else {
        fresh.push({ ...spec, position: { ...position } })
      }
    } else if (node.position.x !== position.x || node.position.y !== position.y) {
      updateNode(id, { position: { ...position } })
    }
  }
  openedTrays.clear()
  if (fresh.length) addNodes(fresh)
  prunePicked()
  applyPicked()
  hasNodes.value = agents.list.length > 0

  if (hasNodes.value && !didInitialFit) {
    didInitialFit = true
    pendingFit = true
  } else if (fit) {
    void nextTick(() => autoFit(motionMs(250)))
  }
}

// A node that goes away fades out first; one that comes back meanwhile keeps its place.
const NODE_EXIT_MS = 150
const TO_TRAY_MS = 560
const FROM_TRAY_MS = 460
const leaving = new Map<string, number>()
const dusting = new Set<string>()
function retireNodes(ids: string[], placed: Map<string, Point>): void {
  const fresh = ids.filter((id) => !leaving.has(id) && !dusting.has(id))
  if (!fresh.length) return
  if (!motionMs(NODE_EXIT_MS)) return removeNodes(fresh)
  const gone: string[] = []
  for (const id of fresh) {
    const agent = agents.byId[id]
    if (!agent && !trayTerminal(id)) {
      gone.push(id)
      continue
    }
    const node = findNode(id)
    const to = agent && node && isFinished(agent) ? trayDot(agent.terminalId, placed) : null
    if (to && node) later(id, TO_TRAY_MS, { class: 'ccm-node-to-tray', style: offsetFrom(node.position, to) })
    else later(id, NODE_EXIT_MS, { class: 'ccm-node-leaving' })
  }
  if (gone.length) void turnToDust(gone)
}
function later(id: string, ms: number, look: Partial<Node>): void {
  updateNode(id, look)
  leaving.set(
    id,
    window.setTimeout(() => {
      leaving.delete(id)
      removeNodes([id])
    }, ms),
  )
}
async function turnToDust(ids: string[]): Promise<void> {
  for (const id of ids) dusting.add(id)
  const boxes = ids.map((id) => nodeBox(id))
  const live = boxes.filter((el): el is HTMLElement => !!el)
  const ok = await dustOutAll(live).catch(() => live.map(() => false))
  for (const id of ids) dusting.delete(id)
  const failed = ids.filter((_, i) => !boxes[i] || !ok[live.indexOf(boxes[i]!)])
  removeNodes(ids.filter((id) => !failed.includes(id)))
  for (const id of failed) later(id, NODE_EXIT_MS, { class: 'ccm-node-leaving' })
  if (ids.some((id) => agents.byId[id])) syncNodes(false)
}
function keepNode(id: string): void {
  window.clearTimeout(leaving.get(id))
  leaving.delete(id)
  updateNode(id, { class: '', style: {} })
}

// Re-layouts glide nodes to their new slots; off for the first placement so the map does not fly in from 0,0.
const nodeMotion = ref(false)
onBeforeUnmount(() => {
  for (const timer of leaving.values()) window.clearTimeout(timer)
  for (const timer of lingerTimers.values()) window.clearTimeout(timer)
})

function isPicked(agentId: string): boolean {
  const terminalId = agents.byId[agentId]?.terminalId
  return !!terminalId && picked.value.has(terminalId)
}

function applyPicked(): void {
  for (const n of getNodes.value) {
    const want = isPicked(n.id)
    if (n.selected !== want) n.selected = want
  }
}

function prunePicked(): void {
  const live = [...picked.value].filter((id) => shownByTerminal.value[id])
  if (live.length !== picked.value.size) picked.value = new Set(live)
}

function togglePicked(terminalId: string): void {
  const next = new Set(picked.value)
  if (!next.delete(terminalId)) next.add(terminalId)
  picked.value = next
}

function clearPicked(): void {
  if (picked.value.size) picked.value = new Set()
}

watch(picked, applyPicked)

const MIN_AUTO_ZOOM = 0.6
const EDGE_PAD = 24

function flowBox(n: GraphNode): Box {
  return { x: n.computedPosition.x, y: n.computedPosition.y, w: n.dimensions.width || MAIN_WIDTH, h: n.dimensions.height || MAIN_HEIGHT }
}

function arcClearance(): number {
  const nodes = getNodes.value
  if (!nodes.length || !peerEdges.value.length) return 0
  const top = Math.min(...nodes.map((n) => n.computedPosition.y))
  let peak = top
  for (const e of peerEdges.value) {
    const a = findNode(e.source)
    const b = findNode(e.target)
    if (!a || !b) continue
    const arc = peerPath(flowBox(a), flowBox(b), peerSlotMap.value.get(e.id))
    if (arc.sameRow) peak = Math.min(peak, arc.mid.y)
  }
  return Math.max(0, Math.ceil(top - peak))
}

function fitPadding() {
  return { ...FIT_PADDING, top: `${FIT_TOP + Math.ceil(arcClearance() * 1.1)}px` as const }
}

async function autoFit(duration = 0): Promise<void> {
  await fitView({ padding: fitPadding(), duration, maxZoom: 1.1 })
  if (getViewport().zoom >= MIN_AUTO_ZOOM) return
  const nodes = getNodes.value
  if (!nodes.length) return
  const minX = Math.min(...nodes.map((n) => n.position.x))
  const minY = Math.min(...nodes.map((n) => n.position.y))
  await setViewport({ x: EDGE_PAD - minX * MIN_AUTO_ZOOM, y: KEEP_CLEAR + EDGE_PAD / 2 + (arcClearance() - minY) * MIN_AUTO_ZOOM, zoom: MIN_AUTO_ZOOM }, { duration })
}

const nodeIds = computed(() => new Set(getNodes.value.map((n) => n.id)))

function measureEdges(ids: string[]): void {
  for (const id of ids) {
    const path = canvas.value?.querySelector<SVGPathElement>(`.vue-flow__edge[data-id="${CSS.escape(id)}"] .vue-flow__edge-path`)
    if (path) path.style.setProperty('--ccm-edge-len', String(Math.ceil(path.getTotalLength()) + 1))
  }
}

// Edges that appear after the first render draw themselves from parent to child.
const EDGE_DRAW_MS = 700
const freshEdges = ref<Set<string>>(new Set())
let knownEdges: Set<string> | null = null
function trackEdges(ids: string[]): void {
  if (!knownEdges) {
    knownEdges = new Set(ids)
    return
  }
  const born = ids.filter((id) => !knownEdges!.has(id))
  knownEdges = new Set(ids)
  const stale = Object.keys(pulses.value).filter((id) => !knownEdges!.has(id))
  if (stale.length) pulses.value = Object.fromEntries(Object.entries(pulses.value).filter(([id]) => knownEdges!.has(id)))
  if (!born.length) return
  freshEdges.value = new Set([...freshEdges.value, ...born])
  for (const id of born) {
    const target = agents.byId[id.slice(id.indexOf('->') + 2)]
    if (target && !isFinished(target)) pulse(id, 'down')
  }
  void nextTick(() => requestAnimationFrame(() => measureEdges(born)))
  window.setTimeout(() => {
    const next = new Set(freshEdges.value)
    for (const id of born) next.delete(id)
    freshEdges.value = next
  }, EDGE_DRAW_MS)
}

const connection = useConnectionStore()
let lastMsg = new Map<string, { agent: Agent; i: number; o: number }>()
watch(
  () => source.value.filter((a) => a.role !== 'main').map((a) => ({ agent: a, i: a.msgIn ?? 0, o: a.msgOut ?? 0 })),
  (rows) => {
    const next = new Map(rows.map((r) => [r.agent.id, r]))
    if (connection.sessionsLoading) {
      lastMsg = next
      return
    }
    for (const [id, r] of next) {
      const prev = lastMsg.get(id)
      if (!prev || prev.agent !== r.agent) continue
      const up = r.o > prev.o
      if (!up && r.i <= prev.i) continue
      const parent = edgeParent.value.get(id)
      if (!parent || !nodeIds.value.has(parent) || !nodeIds.value.has(id)) continue
      if (up) {
        const at = performance.now()
        handedBack.set(id, at)
        if (at - (upAt.get(id) ?? -Infinity) < SAME_UP_MS) continue
        upAt.set(id, at)
      }
      pulse(`${parent}->${id}`, up ? 'up' : 'down')
    }
    lastMsg = next
    for (const map of [handedBack, upAt]) for (const id of map.keys()) if (!next.has(id)) map.delete(id)
  },
  { immediate: true },
)

const peers = usePeersStore()
const nameOf = usePeerName()

const MAX_RUNNERS = 6
let runnerCount = 0
const runners: RunnerBudget = {
  take: () => {
    if (runnerCount >= MAX_RUNNERS) return false
    runnerCount++
    return true
  },
  give: () => {
    runnerCount = Math.max(0, runnerCount - 1)
  },
}
provide(MAP_RUNNERS, runners)

function mainNodeOf(tid: string): string | null {
  const main = shownByTerminal.value[tid]?.find((a) => a.role === 'main')
  return main && nodeIds.value.has(main.id) ? main.id : null
}

type PeerSpec = { id: string; source: string; target: string; data: PeerEdgeData }
const peerEdgeId = (linkId: string) => `peer:${linkId}`

const peerWanted = computed(() => {
  const out = new Map<string, PeerSpec>()
  if (scoped) return out
  const byPair = new Map<string, PeerSpec>()
  const opened: PeerLink[] = []
  for (const l of peers.warm) {
    if (l.kind === 'opened') {
      opened.push(l)
      continue
    }
    const source = mainNodeOf(l.a)
    const target = mainNodeOf(l.b)
    if (!source || !target || source === target) continue
    const spec: PeerSpec = { id: peerEdgeId(l.id), source, target, data: { linkId: l.id, kind: 'message', a: l.a, b: l.b } }
    out.set(spec.id, spec)
    byPair.set(peerLinkId(l.a, l.b), spec)
  }
  for (const l of opened) {
    const source = mainNodeOf(l.a)
    const target = mainNodeOf(l.b)
    if (!source || !target || source === target) continue
    const message = byPair.get(peerLinkId(l.a, l.b))
    if (message) {
      message.data = { ...message.data, opened: { by: l.a, to: l.b } }
      continue
    }
    const spec: PeerSpec = { id: peerEdgeId(l.id), source, target, data: { linkId: l.id, kind: 'opened', a: l.a, b: l.b } }
    out.set(spec.id, spec)
  }
  return out
})

const PEER_FADE_MS = 300
const peerFading = shallowRef<ReadonlyMap<string, PeerSpec>>(new Map())
const peerFadeTimers = new Map<string, number>()
let peerShown: ReadonlyMap<string, PeerSpec> = new Map()
watch(
  peerWanted,
  (wanted) => {
    const fading = new Map(peerFading.value)
    for (const [id, spec] of peerShown) {
      if (wanted.has(id) || fading.has(id)) continue
      fading.set(id, spec)
      peerFadeTimers.set(
        id,
        window.setTimeout(() => {
          peerFadeTimers.delete(id)
          const next = new Map(peerFading.value)
          next.delete(id)
          peerFading.value = next
        }, PEER_FADE_MS),
      )
    }
    for (const id of wanted.keys()) {
      if (!fading.delete(id)) continue
      window.clearTimeout(peerFadeTimers.get(id))
      peerFadeTimers.delete(id)
    }
    peerFading.value = fading
    peerShown = wanted
  },
  { immediate: true },
)

const peerEdges = computed<Edge[]>(() => {
  const all = new Map(peerFading.value)
  for (const [id, spec] of peerWanted.value) all.set(id, spec)
  const out: Edge[] = []
  for (const spec of all.values()) {
    if (!nodeIds.value.has(spec.source) || !nodeIds.value.has(spec.target)) continue
    const a = nameOf(spec.data.a)
    const b = nameOf(spec.data.b)
    out.push({
      id: spec.id,
      source: spec.source,
      target: spec.target,
      type: 'peer',
      class: peerWanted.value.has(spec.id) ? undefined : 'ccm-peer-leaving',
      selectable: false,
      ariaLabel: spec.data.kind === 'opened' ? t('peer.activityOpened', { from: a, to: b }) : t('peerMap.edgeLabel', { a, b }),
      data: spec.data,
    })
  }
  return out
})

const peerSlotMap = computed(() => {
  const ends = peerEdges.value.map((e) => ({ id: e.id, a: e.source, b: e.target }))
  const boxes = new Map<string, Box>()
  for (const e of ends) {
    for (const id of [e.a, e.b]) {
      if (boxes.has(id)) continue
      const n = findNode(id)
      if (n) boxes.set(id, flowBox(n))
    }
  }
  return peerSlots(ends, boxes)
})

const rings = shallowRef<Readonly<Record<string, number>>>({})
function ringCard(tid: string): void {
  rings.value = { ...rings.value, [tid]: (rings.value[tid] ?? 0) + 1 }
}

const FLIGHT_WAIT_MS = 600
type QueuedFlight = { lane: PeerLane; n: number; to: string; timer: number }
const flyers = new Map<string, (lane: PeerLane, n: number) => void>()
const queuedFlights = new Map<string, QueuedFlight[]>()
function queueFlight(edgeId: string, lane: PeerLane, n: number, to: string): void {
  const entry: QueuedFlight = { lane, n, to, timer: 0 }
  entry.timer = window.setTimeout(() => {
    const rest = (queuedFlights.get(edgeId) ?? []).filter((q) => q !== entry)
    if (rest.length) queuedFlights.set(edgeId, rest)
    else queuedFlights.delete(edgeId)
    ringCard(to)
  }, FLIGHT_WAIT_MS)
  queuedFlights.set(edgeId, [...(queuedFlights.get(edgeId) ?? []), entry])
}

const peerMapCtx: PeerMapContext = {
  scoped,
  rings,
  slots: peerSlotMap,
  listen(edgeId, fly) {
    flyers.set(edgeId, fly)
    const queued = queuedFlights.get(edgeId)
    if (queued) {
      queuedFlights.delete(edgeId)
      for (const q of queued) {
        window.clearTimeout(q.timer)
        fly(q.lane, q.n)
      }
    }
    return () => {
      if (flyers.get(edgeId) === fly) flyers.delete(edgeId)
    }
  },
  landed: ringCard,
  goTo: goToPeer,
}
provide(PEER_MAP, peerMapCtx)

const LIVE_MS = 10_000
type LiveItem = { from: string; to: string; n: number }
const liveText = ref('')
const liveBuffer = new Map<string, LiveItem>()
let liveTimer = 0
function say(items: LiveItem[]): void {
  const text = items.map((x) => t('peer.live', { from: nameOf(x.from), to: nameOf(x.to), n: x.n }, x.n)).join(' · ')
  liveText.value = ''
  void nextTick(() => (liveText.value = text))
}
function flushLive(): void {
  liveTimer = 0
  if (!liveBuffer.size) return
  const items = [...liveBuffer.values()]
  liveBuffer.clear()
  say(items)
  liveTimer = window.setTimeout(flushLive, LIVE_MS)
}
function announce(from: string, to: string, n: number): void {
  if (!liveTimer) {
    say([{ from, to, n }])
    liveTimer = window.setTimeout(flushLive, LIVE_MS)
    return
  }
  const key = `${from}>${to}`
  const cur = liveBuffer.get(key)
  if (cur) cur.n += n
  else liveBuffer.set(key, { from, to, n })
}

const CAPSULE_MS = 6000
const CAPSULE_MAX = 3
const SCREEN_MARGIN = 16
type Capsule = { key: number; from: string; to: string; node: string }
const capsules = ref<Capsule[]>([])
const capsuleTimers = new Map<number, number>()
let capsuleSeq = 0
const ARROWS: Record<string, Component> = {
  '-1,-1': ArrowUpLeft,
  '0,-1': ArrowUp,
  '1,-1': ArrowUpRight,
  '-1,0': ArrowLeft,
  '1,0': ArrowRight,
  '-1,1': ArrowDownLeft,
  '0,1': ArrowDown,
  '1,1': ArrowDownRight,
}

function screenCenter(id: string): Point | null {
  const n = findNode(id)
  if (!n) return null
  const { x, y, zoom } = viewport.value
  return {
    x: (n.computedPosition.x + (n.dimensions.width || MAIN_WIDTH) / 2) * zoom + x,
    y: (n.computedPosition.y + (n.dimensions.height || MAIN_HEIGHT) / 2) * zoom + y,
  }
}

function onScreen(p: Point): boolean {
  const { width, height } = dimensions.value
  if (!width || !height) return true
  return p.x >= SCREEN_MARGIN && p.x <= width - SCREEN_MARGIN && p.y >= KEEP_CLEAR && p.y <= height - SCREEN_MARGIN
}

function dismissCapsule(key: number): void {
  window.clearTimeout(capsuleTimers.get(key))
  capsuleTimers.delete(key)
  capsules.value = capsules.value.filter((c) => c.key !== key)
}

function offerCapsule(from: string, to: string, node: string): void {
  const at = screenCenter(node)
  if (!at || onScreen(at)) return
  const fromNode = mainNodeOf(from)
  const fromAt = fromNode ? screenCenter(fromNode) : null
  if (fromAt && !onScreen(fromAt)) return
  for (const c of capsules.value) if (c.to === to) dismissCapsule(c.key)
  const key = ++capsuleSeq
  capsules.value = [...capsules.value, { key, from, to, node }].slice(-CAPSULE_MAX)
  capsuleTimers.set(
    key,
    window.setTimeout(() => dismissCapsule(key), CAPSULE_MS),
  )
}

const capsuleViews = computed(() => {
  const { width, height } = dimensions.value
  return capsules.value.flatMap((c) => {
    const at = screenCenter(c.node)
    if (!at || onScreen(at)) return []
    const dx = at.x < SCREEN_MARGIN ? -1 : at.x > width - SCREEN_MARGIN ? 1 : 0
    const dy = at.y < KEEP_CLEAR ? -1 : at.y > height - SCREEN_MARGIN ? 1 : 0
    const left = dx < 0 ? 12 : dx > 0 ? width - 12 : Math.min(Math.max(at.x, width * 0.2), width * 0.8)
    const top = dy < 0 ? KEEP_CLEAR : dy > 0 ? height - 12 : Math.min(Math.max(at.y, KEEP_CLEAR + 16), height - 28)
    const tx = dx < 0 ? '0' : dx > 0 ? '-100%' : '-50%'
    const ty = dy < 0 ? '0' : dy > 0 ? '-100%' : '-50%'
    return [
      {
        key: c.key,
        to: c.to,
        icon: ARROWS[`${dx},${dy}`] ?? ArrowUp,
        text: t('peer.received', { name: nameOf(c.from) }),
        label: t('peerMap.capsuleLabel', { from: nameOf(c.from), to: nameOf(c.to) }),
        style: { left: `${left}px`, top: `${top}px`, transform: `translate(${tx}, ${ty})` },
      },
    ]
  })
})

let peerSeen = peers.pulses.at(-1)?.key ?? 0
watch(
  () => peers.pulses,
  (list) => {
    const fresh = list.filter((p) => p.key > peerSeen)
    if (!fresh.length) return
    peerSeen = fresh.at(-1)!.key
    for (const p of fresh) onPeerPulse(p)
  },
)

function onPeerPulse(p: PeerPulse): void {
  if (p.kind !== 'message') return
  if (scoped && p.to !== props.terminalId && p.from !== props.terminalId) return
  announce(p.from, p.to, p.n)
  if (ui.mapView !== 'map') return
  const toNode = mainNodeOf(p.to)
  if (!toNode) return
  const edge = peerWanted.value.get(peerEdgeId(p.linkId))
  if (edge) {
    const lane: PeerLane = p.from === edge.data.a ? 'ab' : 'ba'
    const fly = flyers.get(edge.id)
    if (fly) fly(lane, p.n)
    else queueFlight(edge.id, lane, p.n, p.to)
  } else {
    ringCard(p.to)
  }
  offerCapsule(p.from, p.to, toNode)
}

function goToPeer(tid: string): void {
  for (const c of capsules.value) if (c.to === tid) dismissCapsule(c.key)
  const id = mainNodeOf(tid)
  if (!id) {
    ui.focusTerminal(tid)
    return
  }
  cursorId.value = id
  ui.revealTerminal(tid)
  const node = findNode(id)
  if (node) {
    void setCenter(node.computedPosition.x + (node.dimensions.width || MAIN_WIDTH) / 2, node.computedPosition.y + (node.dimensions.height || MAIN_HEIGHT) / 2, {
      zoom: Math.max(getViewport().zoom, MIN_AUTO_ZOOM),
      duration: motionMs(300),
    })
  }
  void nextTick(() => nodeBox(id)?.focus({ preventScroll: true }))
}

function peerTargets(tid: string): { terminalId: string; name: string }[] {
  const ids = new Set<string>()
  for (const l of peers.linksOf(tid)) {
    const other = otherEnd(l, tid)
    if (other && other !== tid && terminals.byId[other]) ids.add(other)
  }
  return [...ids].map((id) => ({ terminalId: id, name: nameOf(id) }))
}

onBeforeUnmount(() => {
  for (const timer of peerFadeTimers.values()) window.clearTimeout(timer)
  for (const list of queuedFlights.values()) for (const q of list) window.clearTimeout(q.timer)
  for (const timer of capsuleTimers.values()) window.clearTimeout(timer)
  window.clearTimeout(liveTimer)
})

const edges = computed<Edge[]>(() => {
  const out: Edge[] = [...peerEdges.value]
  for (const [id, parent] of edgeParent.value) {
    const a = agents.byId[id]
    if (!a || !nodeIds.value.has(id) || !nodeIds.value.has(parent)) continue
    const eid = `${parent}->${id}`
    out.push({
      id: eid,
      source: parent,
      target: id,
      type: 'tree',
      class:
        [a.status === 'working' ? 'ccm-edge-hot' : '', a.provider === 'codex' ? 'ccm-edge-codex' : '', freshEdges.value.has(eid) ? 'ccm-edge-new' : '']
          .join(' ')
          .trim() || undefined,
      selectable: false,
      data: { pulse: pulses.value[eid] },
    })
  }
  for (const tid of trayIds.value) {
    const main = shownByTerminal.value[tid]?.find((a) => a.role === 'main')
    const tray = trayId(tid)
    if (!main || !nodeIds.value.has(main.id) || !nodeIds.value.has(tray)) continue
    out.push({ id: `${main.id}->${tray}`, source: main.id, target: tray, type: 'tree', class: 'ccm-edge-tray', selectable: false })
  }
  return out
})

watch(
  () => edges.value.filter((e) => e.type !== 'peer').map((e) => e.id),
  (ids) => trackEdges(ids),
  { immediate: true },
)

// First sync waits for <VueFlow> to mount: nodes added during setup are dropped when it initializes (remount after a tab switch).
onMounted(() => syncNodes(false))
watch(structureKey, () => syncNodes(false))
watch(
  () => ui.nodeResized,
  () => syncNodes(false),
)
watch(
  () => ui.layoutRequest,
  () => syncNodes(true),
)
// Pinned panels and the session bar change the canvas size; floating panels do not.
let resizeTimer: number | undefined
watch(
  () => [ui.panels.sessions.open && ui.panels.sessions.pinned, ui.panels.activity.open && ui.panels.activity.pinned, ui.barMin].join(','),
  () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => syncNodes(true), 240)
  },
)
watch(
  () => ui.fitRequest,
  () => void fitView({ padding: fitPadding(), duration: motionMs(250), maxZoom: 1.1 }),
)
watch(
  () => ui.focusRequest,
  () => {
    const id = ui.focusedTerminalId
    if (!id) return
    const ids = (shownByTerminal.value[id] ?? []).map((a) => a.id)
    if (ids.length) void fitView({ nodes: [...ids, ...(trayIds.value.includes(id) ? [trayId(id)] : [])], padding: FOCUS_PADDING, duration: motionMs(300), maxZoom: 1.1 })
  },
)

watch(
  () => ui.mapView,
  (view) => {
    if (view !== 'map') return
    void nextTick(() => {
      const restoring = !getNodes.value.length
      syncNodes(false)
      if (restoring && getNodes.value.length) pendingFit = true
    })
  },
)

onNodesInitialized(() => {
  if (!nodeMotion.value) requestAnimationFrame(() => (nodeMotion.value = true))
  if (!pendingFit) return
  pendingFit = false
  void autoFit().then(() => (flyIn ? flyToFit() : undefined))
})

/** After a tab switch the camera eases in toward the tree instead of cutting to it. */
async function flyToFit(): Promise<void> {
  const box = canvas.value
  if (!box || reducedMotion()) return
  const target = getViewport()
  const k = 0.82
  const cx = box.clientWidth / 2
  const cy = box.clientHeight / 2
  await setViewport({ x: cx - (cx - target.x) * k, y: cy - (cy - target.y) * k, zoom: target.zoom * k })
  await setViewport(target, { duration: 420 })
}

watch(
  () => ui.mapView === 'map' && !!ui.selectedAgentId && !visibility.value.visible.has(ui.selectedAgentId),
  (lost) => {
    if (lost) ui.selectAgent(null)
  },
)


// Keyboard cursor: the focused node (roving tabindex). Details (`ui.selectedAgentId`) stay a separate, explicit choice.
const cursorId = ref<string | null>(null)
let navCache: { key: string; nav: MapNav } | null = null
function currentNav(): MapNav {
  if (navCache?.key !== structureKey.value) navCache = { key: structureKey.value, nav: buildNav(terminalOrder.value.map((x) => x.id), shownByTerminal.value, trayIds.value) }
  return navCache.nav
}
const isTrayShown = (id: string) => {
  const tid = trayTerminal(id)
  return !!tid && trayIds.value.includes(tid)
}
const tabStop = computed(() => (cursorId.value && (visibility.value.visible.has(cursorId.value) || isTrayShown(cursorId.value)) ? cursorId.value : (currentNav().columns[0]?.[0] ?? null)))

function nodeBox(id: string): HTMLElement | null {
  return canvas.value?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(id)}"] :is([data-agent-node], [data-tray-node])`) ?? null
}

const KEEP_CLEAR = 56
/** Pans (same zoom) only when the node is off screen or under the floating toolbar. */
function ensureVisible(id: string): void {
  const node = findNode(id)
  const box = canvas.value
  if (!node || !box) return
  const { x, y, zoom } = getViewport()
  const left = node.computedPosition.x * zoom + x
  const top = node.computedPosition.y * zoom + y
  const w = node.dimensions.width * zoom
  const h = node.dimensions.height * zoom
  if (left >= 16 && top >= KEEP_CLEAR && left + w <= box.clientWidth - 16 && top + h <= box.clientHeight - 16) return
  void setCenter(node.computedPosition.x + node.dimensions.width / 2, node.computedPosition.y + node.dimensions.height / 2, { zoom, duration: motionMs(200) })
}

function moveCursor(id: string): void {
  cursorId.value = id
  if (ui.selectedAgentId && ui.selectedAgentId !== id && agents.byId[id]) ui.selectAgent(id)
  void nextTick(() => {
    nodeBox(id)?.focus({ preventScroll: true })
    ensureVisible(id)
  })
}

function onCanvasFocusIn(e: FocusEvent): void {
  const id = (e.target as HTMLElement | null)?.closest<HTMLElement>('.vue-flow__node')?.dataset.id
  if (id) cursorId.value = id
}

watch(
  () => cursorId.value && !visibility.value.visible.has(cursorId.value) && !isTrayShown(cursorId.value),
  (lost) => {
    if (lost) cursorId.value = null
  },
)

function toggleFold(id: string): void {
  ui.setCollapsed(id, !ui.collapsedAgents.has(id))
  if (cursorId.value && !visibility.value.visible.has(cursorId.value)) moveCursor(id)
}

/** Ancestors of `id` on the map (incl. the session's main agent, which adopts orphans). */
function ancestorsOf(id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let cur = agents.byId[id]
  while (cur?.parentId && !seen.has(cur.parentId) && agents.byId[cur.parentId]) {
    seen.add(cur.parentId)
    out.push(cur.parentId)
    cur = agents.byId[cur.parentId]
  }
  const main = agents.byId[id] ? agents.mainOf(agents.byId[id]!.terminalId) : undefined
  if (main && main.id !== id && !seen.has(main.id)) out.push(main.id)
  return out
}

function unfoldTo(id: string): boolean {
  let changed = false
  for (const a of ancestorsOf(id)) {
    if (!ui.collapsedAgents.has(a)) continue
    ui.setCollapsed(a, false)
    changed = true
  }
  return changed
}

/** Waits for a node that a fold / filter change just added, then zooms to it. */
async function zoomTo(id: string): Promise<void> {
  await nextTick()
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  if (!findNode(id)?.dimensions.width) await new Promise<void>((r) => window.setTimeout(r, 120))
  await fitView({ nodes: [id], padding: 0.6, duration: motionMs(250), maxZoom: 1.1 })
}

const sessionsOrder = computed(() => terminalOrder.value.map((x) => x.id))
const finishedByTerminal = computed(() => {
  const out: Record<string, Agent[]> = {}
  for (const a of finishedList.value) (out[a.terminalId] ??= []).push(a)
  return out
})

const actions = useAgentActions((id) => finishedByTerminal.value[id] ?? [])
const { labels: textLabels, notice, copyText, copySummary, sessionsText } = actions

// Find: matches in session / tree order, including agents inside folded subtrees (unfolded on the way there).
const findOpen = ref(false)
const query = ref('')
const matchIndex = ref(0)
const findInput = ref<HTMLInputElement | null>(null)
const matchList = computed<string[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!findOpen.value || !q) return []
  const out: string[] = []
  for (const tid of sessionsOrder.value) {
    const list = finishedByTerminal.value[tid]
    if (!list?.length) continue
    const term = terminals.byId[tid]
    const main = list.find((a) => a.role === 'main')
    const ordered = [...(main ? [main] : []), ...treeOrder(list).map((x) => x.agent)]
    for (const a of ordered) if (searchText(a, term, textLabels.value).includes(q)) out.push(a.id)
  }
  return out
})
const matches = computed(() => (findOpen.value && query.value.trim() ? new Set(matchList.value) : null))
const currentMatch = computed(() => matchList.value[matchIndex.value] ?? null)

function goToMatch(): void {
  const id = currentMatch.value
  if (!id) return
  cursorId.value = id
  unfoldTo(id)
  void zoomTo(id)
}
watch(query, () => {
  matchIndex.value = 0
  goToMatch()
})
function stepMatch(dir: 1 | -1): void {
  const n = matchList.value.length
  if (!n) return
  matchIndex.value = (matchIndex.value + dir + n) % n
  goToMatch()
}
async function openFind(): Promise<void> {
  if (ui.mapView !== 'map') return
  findOpen.value = true
  await nextTick()
  findInput.value?.focus()
  findInput.value?.select()
}
function closeFind(refocus = true): void {
  findOpen.value = false
  if (!refocus) return
  const id = currentMatch.value ?? tabStop.value
  query.value = ''
  if (id) moveCursor(id)
}
function onFindKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
  else if (e.key === 'Escape') closeFind()
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') stepMatch(e.key === 'ArrowDown' ? 1 : -1)
  else return
  e.preventDefault()
  e.stopPropagation()
}

const mapNode: MapNodeContext = {
  tabStop,
  matches,
  currentMatch,
  children: childMap,
  hiddenUnder: computed(() => folding.value.hiddenUnder),
  collapsed: computed(() => ui.collapsedAgents),
  toggleFold,
}
provide('ccm-map-node', mapNode)

/** Ctrl+C on a node: picked sessions as a tree when the node belongs to them, else this agent's summary. */
function copyFocused(id: string): void {
  const tid = agents.byId[id]?.terminalId
  if (tid && picked.value.size > 1 && picked.value.has(tid)) void copyText(sessionsText(sessionsOrder.value.filter((x) => picked.value.has(x))), 'picked', { n: picked.value.size })
  else copySummary(id)
}

onNodeClick(({ node, event }) => {
  const tray = trayTerminal(node.id)
  if (tray) {
    cursorId.value = node.id
    ui.toggleTray(tray)
    return
  }
  // A drag that selected text in the node ends in a click; it must not toggle the details.
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && (event.target as Node | null) && nodeBox(node.id)?.contains(sel.anchorNode)) return
  const terminalId = agents.byId[node.id]?.terminalId
  cursorId.value = node.id
  if (!scoped && terminalId && (event.ctrlKey || event.metaKey || event.shiftKey)) {
    togglePicked(terminalId)
    return
  }
  const selecting = ui.selectedAgentId !== node.id
  ui.selectAgent(selecting ? node.id : null)
  if (selecting && terminalId) ui.revealTerminal(terminalId)
})

// Right-click (or the menu key / Shift+F10): node actions incl. its workspace pane and copies; canvas actions on the background.
type MenuState = { kind: 'node'; agentId: string; at: DOMRect; trigger: HTMLElement | null } | { kind: 'canvas'; at: DOMRect; trigger: HTMLElement | null }
const menu = ref<MenuState | null>(null)

const menuEntries = computed<MenuEntry[]>(() => {
  const m = menu.value
  if (!m) return []
  if (m.kind === 'canvas')
    return canvasMenu({ hasNodes: hasNodes.value, anyCollapsed: ui.collapsedAgents.size > 0, anyParent: childMap.value.size > 0, hideFinished: !allTraysOpen.value }, t, isMac)
  const a = agents.byId[m.agentId]
  return nodeMenu(
    {
      ...actions.menuBase(a?.terminalId ?? '', m.agentId),
      scope: 'map',
      children: childMap.value.get(m.agentId) ?? 0,
      collapsed: ui.collapsedAgents.has(m.agentId),
      picked: a && picked.value.has(a.terminalId) ? picked.value.size : 0,
      detailsOpen: ui.selectedAgentId === m.agentId,
      peers: a?.role === 'main' ? peerTargets(a.terminalId) : undefined,
    },
    t,
    isMac,
  )
})
const menuLabel = computed(() => {
  const m = menu.value
  if (m?.kind !== 'node') return t('map.menu.canvasLabel')
  const a = agents.byId[m.agentId]
  return t('map.menu.label', { name: a ? agentName(a, terminals.byId[a.terminalId], textLabels.value) : '' })
})

const NODE_KEYS = { copy: keyCombo(['Mod', 'C'], isMac), menu: keyCombo(['Shift', 'F10'], isMac), find: keyCombo(['Mod', 'F'], isMac) }

/** Windows fires a native `contextmenu` after the ContextMenu / Shift+F10 keydown that already opened the menu. */
const KEY_MENU_ECHO_MS = 300
let keyMenuAt = 0

function openNodeMenu(agentId: string, at: DOMRect, trigger: HTMLElement | null): void {
  if (!agents.byId[agentId]) return
  cursorId.value = agentId
  menu.value = { kind: 'node', agentId, at, trigger }
}
onNodeContextMenu(({ node, event }) => {
  event.preventDefault()
  if (menu.value && performance.now() - keyMenuAt < KEY_MENU_ECHO_MS) return
  const p = 'clientX' in event ? event : event.touches[0]
  if (!p) return
  openNodeMenu(node.id, new DOMRect(p.clientX, p.clientY, 0, 0), nodeBox(node.id))
})
onPaneContextMenu((event) => {
  event.preventDefault()
  if (ui.mapView !== 'map') return
  menu.value = { kind: 'canvas', at: new DOMRect(event.clientX, event.clientY, 0, 0), trigger: null }
})

function runNode(action: NodeAction, id: string): void {
  const a = agents.byId[id]
  if (!a) return
  const tid = a.terminalId
  if (actions.run(action, tid, id)) return
  switch (action) {
    case 'copy-picked':
      void copyText(sessionsText(sessionsOrder.value.filter((x) => picked.value.has(x))), 'picked', { n: picked.value.size })
      break
    case 'zoom-node':
      void zoomTo(id)
      break
    case 'show-session':
      ui.setView('monitor')
      ui.focusTerminal(tid)
      break
    case 'details':
      ui.selectAgent(ui.selectedAgentId === id ? null : id)
      break
    case 'toggle-subtree':
      toggleFold(id)
      break
  }
}

function runCanvas(action: CanvasAction): void {
  switch (action) {
    case 'fit':
      ui.requestFit()
      break
    case 'reset-layout':
      ui.resetLayout()
      break
    case 'expand-all':
      ui.collapsedAgents = new Set()
      break
    case 'collapse-all':
      ui.collapsedAgents = new Set(childMap.value.keys())
      break
    case 'toggle-finished':
      toggleAllTrays()
      break
    case 'copy-map':
      void copyText(sessionsText(sessionsOrder.value), 'map')
      break
    case 'find':
      void openFind()
      break
  }
}

function onMenuPick(id: string): void {
  const m = menu.value
  if (!m) return
  if (m.kind === 'canvas') {
    runCanvas(id as CanvasAction)
    return
  }
  const peer = peerTarget(id)
  if (peer) goToPeer(peer)
  else runNode(id as NodeAction, m.agentId)
}

function onCanvasKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || ui.mapView !== 'map' || isTyping(e.target)) return
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.vue-flow__node')
  const id = el?.dataset.id
  const mod = e.ctrlKey || e.metaKey
  if (e.key === '/' && !mod) {
    e.preventDefault()
    void openFind()
    return
  }
  if (!id) return
  const tray = trayTerminal(id)
  if (tray) {
    if ((e.key === 'Enter' || e.key === ' ') && !mod) {
      e.preventDefault()
      ui.toggleTray(tray)
    } else if (NAV_KEYS.includes(e.key) && !mod && !e.altKey) {
      e.preventDefault()
      const next = navigate(currentNav(), id, e.key as NavKey)
      if (next) moveCursor(next)
    }
    return
  }
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault()
    keyMenuAt = performance.now()
    const box = nodeBox(id)
    openNodeMenu(id, (box ?? el!).getBoundingClientRect(), box)
    return
  }
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyC') {
    // Text the user selected copies natively; with nothing selected Ctrl+C copies the node.
    if (window.getSelection()?.toString()) return
    e.preventDefault()
    copyFocused(id)
    return
  }
  if (mod || e.altKey) return
  if (NAV_KEYS.includes(e.key)) {
    e.preventDefault()
    if (e.key === 'ArrowRight' && ui.collapsedAgents.has(id)) {
      toggleFold(id)
      return
    }
    const next = navigate(currentNav(), id, e.key as NavKey)
    if (next) moveCursor(next)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const tid = agents.byId[id]?.terminalId
    if (e.shiftKey) {
      if (tid) reveal.show(tid)
      return
    }
    ui.selectAgent(ui.selectedAgentId === id ? null : id)
    return
  }
  if (e.key === ' ' && !e.shiftKey) {
    e.preventDefault()
    if ((childMap.value.get(id) ?? 0) > 0 || ui.collapsedAgents.has(id)) toggleFold(id)
    return
  }
  if (e.key === 'Escape' && picked.value.size && !ui.selectedAgentId) {
    e.preventDefault()
    clearPicked()
  }
}

// Ctrl/⌘+F anywhere on the Monitor view (not inside fields / other dialogs) opens find on the map.
function onDocKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== 'KeyF') return
  if (ui.view !== 'monitor' || ui.mapView !== 'map' || !hasNodes.value || isTyping(e.target)) return
  if (ui.paletteOpen || ui.settingsOpen || ui.tourOpen || ui.recapOpen || ui.diagnosticsOpen || ui.shortcutsOpen) return
  e.preventDefault()
  void openFind()
}
onMounted(() => document.addEventListener('keydown', onDocKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onDocKey))

onPaneClick(() => {
  ui.selectAgent(null)
  clearPicked()
})
onNodeDragStop(({ nodes }) => {
  if (scoped) return
  for (const n of nodes) if (!trayTerminal(n.id)) ui.setNodePos(n.id, n.position)
  syncNodes(false)
})

const TOOL = 'ccm-btn-plain ccm-press text-xs'
const CHROME_BTN =
  'ccm-material ccm-press pointer-events-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control px-2 text-xs text-ink-muted shadow-pop transition-colors hover:text-ink'

const controls = computed<{ key: string; label: string; icon: typeof Plus; hint?: string; run: () => unknown }[]>(() => [
  { key: 'zoomIn', label: t('map.zoomIn'), icon: Plus, run: () => zoomIn({ duration: motionMs(150) }) },
  { key: 'zoomOut', label: t('map.zoomOut'), icon: Minus, run: () => zoomOut({ duration: motionMs(150) }) },
  { key: 'fit', label: t('map.fit'), icon: Maximize, hint: 'F', run: () => ui.requestFit() },
  { key: 'reset', label: t('map.reset'), icon: LayoutGrid, run: () => ui.resetLayout() },
])

const views = computed(() => [
  { value: 'map' as MapView, label: t('tools.view.map'), icon: Network },
  { value: 'timeline' as MapView, label: t('tools.view.timeline'), icon: ChartGantt },
  { value: 'office' as MapView, label: t('officeV60.view'), icon: Building2 },
])

const office = useOfficeStore()
const officeControls = computed<{ key: string; label: string; icon: typeof Plus; hint?: string; run: () => unknown }[]>(() => [
  { key: 'zoomIn', label: t('officeV60.zoomIn'), icon: Plus, run: () => office.zoomBy(1.25) },
  { key: 'zoomOut', label: t('officeV60.zoomOut'), icon: Minus, run: () => office.zoomBy(0.8) },
  { key: 'overview', label: t('officeV60.overview'), icon: Maximize, hint: 'F', run: () => office.overview() },
])
const volumePct = computed(() => Math.round(office.volume * 100))
const volumeIcon = computed(() => (!office.sound || volumePct.value === 0 ? VolumeX : volumePct.value < 50 ? Volume1 : Volume2))
/** Wheel over the speaker or slider nudges the volume by one step, as on the macOS menu bar. */
function onVolumeWheel(e: WheelEvent): void {
  if (!e.deltaY) return
  office.setVolume((volumePct.value + (e.deltaY < 0 ? 5 : -5)) / 100)
}
const regionLabel = computed(() => t(ui.mapView === 'timeline' ? 'tools.ariaLabel' : ui.mapView === 'office' ? 'officeV60.view' : 'map.ariaLabel'))
</script>

<template>
  <section :aria-labelledby="`${FLOW_ID}-title`" class="flex min-h-0 flex-col">
    <h2 :id="`${FLOW_ID}-title`" class="sr-only">{{ t('map.title') }}</h2>
    <div
      ref="canvas"
      class="relative min-h-0 flex-1 overflow-hidden"
      :class="[nodeMotion ? 'ccm-map-motion' : '', ui.mapView === 'timeline' ? 'bg-surface' : 'bg-canvas']"
      role="region"
      :aria-label="regionLabel"
      @keydown="onCanvasKey"
      @focusin="onCanvasFocusIn"
    >
      <ToolTimeline v-if="ui.mapView === 'timeline'" :terminal-id="terminalId" />
      <OfficeView v-else-if="ui.mapView === 'office'" :terminal-id="terminalId" />
      <VueFlow
        v-else
        :id="FLOW_ID"
        :edges="edges"
        :min-zoom="0.2"
        :max-zoom="2"
        :nodes-connectable="false"
        :elements-selectable="false"
        :nodes-focusable="false"
        :edges-focusable="false"
        :disable-keyboard-a11y="true"
        :zoom-on-double-click="false"
        :delete-key-code="null"
        :selection-key-code="null"
        :default-edge-options="{ type: 'tree' }"
        class="h-full w-full"
      >
        <Background :gap="18" :size="1" pattern-color="var(--ccm-flow-dot)" />
        <template #node-main="nodeProps">
          <MainNode :id="nodeProps.id" :data="nodeProps.data" :picked="nodeProps.selected" />
        </template>
        <template #node-sub="nodeProps">
          <SubPill :id="nodeProps.id" :data="nodeProps.data" :picked="nodeProps.selected" />
        </template>
        <template #node-tray="nodeProps">
          <DoneTray :id="nodeProps.id" :data="nodeProps.data" />
        </template>
        <template #edge-tree="edgeProps">
          <TreeEdge v-bind="edgeProps" />
        </template>
        <template #edge-peer="edgeProps">
          <PeerEdge v-bind="edgeProps" />
        </template>
      </VueFlow>
      <p :id="`${FLOW_ID}-keys`" class="sr-only">{{ t('map.node.keys', NODE_KEYS) }}</p>
      <p class="sr-only" aria-live="polite" data-peer-live>{{ liveText }}</p>
      <TransitionGroup v-if="ui.mapView === 'map'" name="ccm-peer-capsule" tag="div" class="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        <div v-for="c in capsuleViews" :key="c.key" class="absolute" :style="c.style">
          <button
            type="button"
            class="ccm-press pointer-events-auto inline-flex h-7 max-w-64 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs text-ink shadow-pop transition-colors hover:bg-raised"
            :aria-label="c.label"
            :title="c.label"
            data-peer-capsule
            @click="goToPeer(c.to)"
          >
            <Mail :size="13" class="shrink-0 text-peer" aria-hidden="true" />
            <span class="truncate">{{ c.text }}</span>
            <component :is="c.icon" :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
          </button>
        </div>
      </TransitionGroup>
      <ContextMenu
        v-if="menu"
        :at="menu.at"
        :entries="menuEntries"
        :label="menuLabel"
        :trigger="menu.trigger"
        @pick="onMenuPick"
        @close="menu = null"
      />

      <div
        v-if="findOpen && ui.mapView === 'map'"
        class="ccm-menu absolute top-12 left-1/2 z-20 flex w-[min(360px,calc(100%-16px))] -translate-x-1/2 items-center gap-1 p-1"
        role="search"
        data-map-find
      >
        <Search :size="14" class="ml-1.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <input
          ref="findInput"
          v-model="query"
          type="text"
          class="h-7 min-w-0 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-faint"
          :placeholder="t('map.find.placeholder')"
          :aria-label="t('map.find.label')"
          spellcheck="false"
          autocomplete="off"
          @keydown="onFindKey"
        />
        <span class="shrink-0 px-1 text-2xs tabular-nums text-ink-muted" aria-live="polite">
          {{ query.trim() ? (matchList.length ? t('map.find.count', { i: matchIndex + 1, n: matchList.length }) : t('map.find.none')) : '' }}
        </span>
        <button type="button" :class="TOOL" :aria-label="t('map.find.prev')" :title="t('map.find.prev')" :disabled="!matchList.length" @click="stepMatch(-1)">
          <ChevronUp :size="15" aria-hidden="true" />
        </button>
        <button type="button" :class="TOOL" :aria-label="t('map.find.next')" :title="t('map.find.next')" :disabled="!matchList.length" @click="stepMatch(1)">
          <ChevronDown :size="15" aria-hidden="true" />
        </button>
        <button type="button" :class="TOOL" :aria-label="t('map.find.close')" :title="t('map.find.close')" aria-keyshortcuts="Escape" @click="closeFind()">
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <div class="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4" role="status" aria-live="polite">
        <Transition name="ccm-menu">
          <p
            v-if="notice"
            :key="notice.n"
            class="ccm-menu max-w-full truncate px-3 py-1.5 text-xs"
            :class="notice.failed ? 'text-st-error' : 'text-ink'"
            data-map-notice
          >
            {{ notice.text }}
          </p>
        </Transition>
      </div>

      <div v-if="ui.mapView === 'map' && !hasNodes" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-sm text-ink-muted">
        <ArtImage name="agent-map-bg" class="w-full max-w-3xl opacity-25" />
        <p>{{ t('map.empty') }}</p>
      </div>

      <div class="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
        <button
          type="button"
          :class="[CHROME_BTN, ui.isCollapsed('sessions') ? '' : 'invisible']"
          :aria-label="t('map.showSessions')"
          :title="t('map.showSessions')"
          aria-keyshortcuts="S"
          @click="ui.togglePanel('sessions')"
        >
          <PanelLeft :size="16" aria-hidden="true" /><span class="hidden sm:inline">{{ ui.sessionTab ? t('panel.session') : t('sessions.title') }}</span><KeyHint keys="S" />
        </button>

        <div class="ccm-material pointer-events-auto flex flex-wrap items-center justify-center gap-0.5 rounded-control p-0.5 shadow-pop" role="toolbar" :aria-label="t('map.title')">
          <SegmentedControl v-model="ui.mapView" :options="views" :label="t('tools.view.label')" />
          <template v-if="ui.mapView === 'timeline'">
            <button
              v-for="w in WINDOWS"
              :key="w"
              type="button"
              :class="[TOOL, 'tabular-nums']"
              :aria-pressed="ui.timelineWindow === w"
              @click="ui.timelineWindow = w"
            >
              {{ t('tools.minutes', { n: w }) }}
            </button>
          </template>
          <template v-else-if="ui.mapView === 'office'">
            <button
              v-for="c in officeControls"
              :key="c.key"
              type="button"
              :class="TOOL"
              :aria-label="c.label"
              :title="c.label"
              :aria-keyshortcuts="c.hint"
              :disabled="!office.world"
              @click="c.run()"
            >
              <component :is="c.icon" :size="16" aria-hidden="true" />
              <KeyHint v-if="c.hint" :keys="c.hint" />
            </button>
            <div class="flex items-center" data-office-sound @wheel.prevent="onVolumeWheel">
              <button
                type="button"
                :class="TOOL"
                :aria-pressed="office.sound"
                :aria-label="t('officeV60.sound')"
                :title="t('officeV60.sound')"
                @click="office.setSound(!office.sound)"
              >
                <component :is="volumeIcon" :size="16" aria-hidden="true" />
              </button>
              <input
                type="range"
                class="ccm-slider mr-1.5 ml-0.5 w-20"
                min="0"
                max="100"
                step="5"
                :value="volumePct"
                :style="{ '--ccm-slider-value': `${volumePct}%` }"
                :data-muted="office.sound ? undefined : ''"
                :aria-label="t('officeV60.volume')"
                :aria-valuetext="t('officeV60.volumeValue', { n: volumePct })"
                :title="t('officeV60.volumeHint', { n: volumePct })"
                data-office-volume
                @input="office.setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
              />
            </div>
            <button
              type="button"
              :class="TOOL"
              :aria-pressed="office.timelapse"
              :aria-label="office.timelapse ? t('officeV60.timelapse.close') : t('officeV60.timelapse.open')"
              :title="office.timelapse ? t('officeV60.timelapse.close') : t('officeV60.timelapse.open')"
              aria-keyshortcuts="L"
              :disabled="!office.world && !office.timelapse"
              data-office-timelapse-toggle
              @click="office.toggleTimelapse()"
            >
              <History :size="16" aria-hidden="true" />
              <KeyHint keys="L" />
            </button>
            <OfficeOptions />
          </template>
          <template v-else>
            <button
              v-if="picked.size"
              type="button"
              :class="TOOL"
              class="bg-fill! text-ink!"
              :aria-label="t('map.clearPicked')"
              :title="t('map.clearPicked')"
              @click="clearPicked()"
            >
              <span class="tabular-nums">{{ t('map.picked', { n: picked.size }) }}</span>
              <X :size="15" aria-hidden="true" />
            </button>
            <button
              type="button"
              :class="TOOL"
              :aria-pressed="allTraysOpen"
              :aria-label="allTraysOpen ? t('mapV53.tray.closeAll') : t('mapV53.tray.openAll')"
              :title="allTraysOpen ? t('mapV53.tray.closeAll') : t('mapV53.tray.openAll')"
              :disabled="!Object.keys(trays).length"
              @click="toggleAllTrays()"
            >
              <component :is="allTraysOpen ? Eye : EyeOff" :size="16" aria-hidden="true" />
              <span v-if="!allTraysOpen && hiddenTotal > 0" class="tabular-nums">{{ t('map.hiddenCount', { n: hiddenTotal }) }}</span>
            </button>
            <button
              v-for="c in controls"
              :key="c.key"
              type="button"
              :class="TOOL"
              :aria-label="c.label"
              :title="c.label"
              :aria-keyshortcuts="c.hint"
              :disabled="!hasNodes"
              @click="c.run()"
            >
              <component :is="c.icon" :size="16" aria-hidden="true" />
              <KeyHint v-if="c.hint" :keys="c.hint" />
            </button>
          </template>
        </div>

        <button
          type="button"
          :class="[CHROME_BTN, ui.isCollapsed('activity') ? '' : 'invisible']"
          :aria-label="t('map.showActivity')"
          :title="t('map.showActivity')"
          aria-keyshortcuts="A"
          @click="ui.togglePanel('activity')"
        >
          <span class="hidden sm:inline">{{ t('activity.title') }}</span><KeyHint keys="A" /><PanelRight :size="16" aria-hidden="true" />
        </button>
      </div>

      <AgentDetails v-if="ui.mapView === 'map'" :flow-id="FLOW_ID" />
    </div>
  </section>
</template>

<style>
.ccm-peer-capsule-enter-active {
  transition:
    opacity var(--ccm-dur-base) var(--ease-out-quint),
    scale var(--ccm-dur-base) var(--ease-spring);
}
.ccm-peer-capsule-leave-active {
  transition: opacity var(--ccm-dur-fast) var(--ease-exit);
}
.ccm-peer-capsule-enter-from {
  opacity: 0;
  scale: 0.85;
}
.ccm-peer-capsule-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .ccm-peer-capsule-enter-from {
    scale: 1;
  }
}
</style>
