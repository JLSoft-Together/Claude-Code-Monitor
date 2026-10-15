<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ChartGantt, ChevronDown, ChevronUp, Eye, EyeOff, LayoutGrid, Maximize, Minus, Network, PanelLeft, PanelRight, Plus, Search, X } from 'lucide-vue-next'
import type { Agent } from '@ccm/shared'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { useSettingsStore } from '../stores/settings'
import { useUiStore, type MapView } from '../stores/ui'
import { useAgentActions } from '../composables/useAgentActions'
import { useRevealInWorkspace } from '../composables/useRevealInWorkspace'
import { columnsFor, computeLayout, treeOrder, visibleAgents } from '../lib/layout'
import { canvasMenu, nodeMenu, type CanvasAction, type NodeAction } from '../lib/mapMenu'
import { buildNav, childCounts, hideCollapsed, navigate, NAV_KEYS, type MapNav, type MapNodeContext, type NavKey } from '../lib/mapNav'
import { agentName, searchText } from '../lib/mapText'
import type { MenuEntry } from '../lib/menu'
import { motionMs, nextMapIsSwitch, reducedMotion } from '../lib/motion'
import { isMac } from '../lib/platform'
import { isTyping, keyCombo } from '../lib/shortcuts'
import { WINDOWS } from '../lib/toolTimeline'
import AgentDetails from './AgentDetails.vue'
import ContextMenu from './ui/ContextMenu.vue'
import AgentNode from './AgentNode.vue'
import KeyHint from './KeyHint.vue'
import SegmentedControl from './ui/SegmentedControl.vue'
import ToolTimeline from './ToolTimeline.vue'

const props = defineProps<{ terminalId?: string | null }>()
const { t } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()
const settings = useSettingsStore()

const scoped = !!props.terminalId
const FLOW_ID = scoped ? `agent-map-${props.terminalId}` : 'agent-map'
const { addNodes, removeNodes, getNodes, findNode, fitView, getViewport, setViewport, setCenter, zoomIn, zoomOut, updateNode, onNodeClick, onNodeContextMenu, onNodeDragStop, onPaneClick, onPaneContextMenu, onNodesInitialized } =
  useVueFlow(FLOW_ID)
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
const finished = computed(() => visibleAgents(source.value, settings.hideFinished))
// Text copies and find walk this list: folded subtrees still count, hidden finished subagents do not.
const finishedList = computed(() => source.value.filter((a) => finished.value.visible.has(a.id)))
const folding = computed(() => hideCollapsed(finishedList.value, ui.collapsedAgents))
const childMap = computed(() => childCounts(finishedList.value))
const visibility = computed(() => ({ visible: folding.value.visible, hidden: finished.value.hidden }))
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
  ].join('#'),
)

function syncNodes(fit = false): void {
  const placed = computeLayout({
    terminals: terminalOrder.value.map((x) => x.id),
    agentsByTerminal: shownByTerminal.value,
    perRow: columnsFor(canvas.value?.clientWidth ?? 900),
    sizes: ui.nodeSizes,
  })
  const wanted = new Set(shownList.value.map((a) => a.id))
  const current = new Map(getNodes.value.map((n) => [n.id, n]))

  retireNodes([...current.keys()].filter((id) => !wanted.has(id)))

  const fresh: Node[] = []
  for (const id of wanted) {
    const position = (scoped ? undefined : ui.nodePos[id]) ?? placed.get(id)
    if (!position) continue
    const node = current.get(id)
    if (node && leaving.has(id)) keepNode(id)
    if (!node) {
      fresh.push({ id, type: 'agent', position: { ...position }, data: { agentId: id }, draggable: true, selectable: false })
    } else if (node.position.x !== position.x || node.position.y !== position.y) {
      updateNode(id, { position: { ...position } })
    }
  }
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
const leaving = new Map<string, number>()
function retireNodes(ids: string[]): void {
  const fresh = ids.filter((id) => !leaving.has(id))
  if (!fresh.length) return
  if (!motionMs(NODE_EXIT_MS)) return removeNodes(fresh)
  for (const id of fresh) {
    updateNode(id, { class: 'ccm-node-leaving' })
    leaving.set(
      id,
      window.setTimeout(() => {
        leaving.delete(id)
        removeNodes([id])
      }, NODE_EXIT_MS),
    )
  }
}
function keepNode(id: string): void {
  window.clearTimeout(leaving.get(id))
  leaving.delete(id)
  updateNode(id, { class: '' })
}

// Re-layouts glide nodes to their new slots; off for the first placement so the map does not fly in from 0,0.
const nodeMotion = ref(false)
onBeforeUnmount(() => {
  for (const timer of leaving.values()) window.clearTimeout(timer)
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

async function autoFit(duration = 0): Promise<void> {
  await fitView({ padding: 0.2, duration, maxZoom: 1.1 })
  if (getViewport().zoom >= MIN_AUTO_ZOOM) return
  const nodes = getNodes.value
  if (!nodes.length) return
  const minX = Math.min(...nodes.map((n) => n.position.x))
  const minY = Math.min(...nodes.map((n) => n.position.y))
  await setViewport({ x: EDGE_PAD - minX * MIN_AUTO_ZOOM, y: EDGE_PAD - minY * MIN_AUTO_ZOOM, zoom: MIN_AUTO_ZOOM }, { duration })
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
  if (!born.length) return
  freshEdges.value = new Set([...freshEdges.value, ...born])
  void nextTick(() => requestAnimationFrame(() => measureEdges(born)))
  window.setTimeout(() => {
    const next = new Set(freshEdges.value)
    for (const id of born) next.delete(id)
    freshEdges.value = next
  }, EDGE_DRAW_MS)
}

const edges = computed<Edge[]>(() =>
  shownList.value
    .filter((a) => a.parentId && visibility.value.visible.has(a.parentId) && nodeIds.value.has(a.id) && nodeIds.value.has(a.parentId))
    .map((a) => ({
      id: `${a.parentId}->${a.id}`,
      source: a.parentId!,
      target: a.id,
      type: 'smoothstep',
      class:
        [a.status === 'working' ? 'ccm-edge-hot' : '', a.provider === 'codex' ? 'ccm-edge-codex' : '', freshEdges.value.has(`${a.parentId}->${a.id}`) ? 'ccm-edge-new' : '']
          .join(' ')
          .trim() || undefined,
      selectable: false,
      pathOptions: { borderRadius: 6 },
    })),
)

watch(
  () => edges.value.map((e) => e.id),
  (ids) => trackEdges(ids),
  { immediate: true },
)

// First sync waits for <VueFlow> to mount: nodes added during setup are dropped when it initializes (remount after a tab switch).
onMounted(() => syncNodes(false))
watch(structureKey, () => syncNodes(false))
watch(
  () => settings.hideFinished,
  () => void nextTick(() => syncNodes(true)),
)
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
  () => void fitView({ padding: 0.2, duration: motionMs(250), maxZoom: 1.1 }),
)
watch(
  () => ui.focusRequest,
  () => {
    const id = ui.focusedTerminalId
    if (!id) return
    const ids = (shownByTerminal.value[id] ?? []).map((a) => a.id)
    if (ids.length) void fitView({ nodes: ids, padding: 0.35, duration: motionMs(300), maxZoom: 1.1 })
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
  () => ui.selectedAgentId && !visibility.value.visible.has(ui.selectedAgentId),
  (lost) => {
    if (lost) ui.selectAgent(null)
  },
)


// Keyboard cursor: the focused node (roving tabindex). Details (`ui.selectedAgentId`) stay a separate, explicit choice.
const cursorId = ref<string | null>(null)
let navCache: { key: string; nav: MapNav } | null = null
function currentNav(): MapNav {
  if (navCache?.key !== structureKey.value) navCache = { key: structureKey.value, nav: buildNav(terminalOrder.value.map((x) => x.id), shownByTerminal.value) }
  return navCache.nav
}
const tabStop = computed(() => (cursorId.value && visibility.value.visible.has(cursorId.value) ? cursorId.value : (currentNav().columns[0]?.[0] ?? null)))

function nodeBox(id: string): HTMLElement | null {
  return canvas.value?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(id)}"] [data-agent-node]`) ?? null
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
  if (ui.selectedAgentId && ui.selectedAgentId !== id) ui.selectAgent(id)
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
  () => cursorId.value && !visibility.value.visible.has(cursorId.value),
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
    return canvasMenu({ hasNodes: hasNodes.value, anyCollapsed: ui.collapsedAgents.size > 0, anyParent: childMap.value.size > 0, hideFinished: settings.hideFinished }, t, isMac)
  const a = agents.byId[m.agentId]
  return nodeMenu(
    {
      ...actions.menuBase(a?.terminalId ?? '', m.agentId),
      scope: 'map',
      children: childMap.value.get(m.agentId) ?? 0,
      collapsed: ui.collapsedAgents.has(m.agentId),
      picked: a && picked.value.has(a.terminalId) ? picked.value.size : 0,
      detailsOpen: ui.selectedAgentId === m.agentId,
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
      settings.toggleHideFinished()
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
  if (m.kind === 'canvas') runCanvas(id as CanvasAction)
  else runNode(id as NodeAction, m.agentId)
}

function onCanvasKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || isTyping(e.target)) return
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.vue-flow__node')
  const id = el?.dataset.id
  const mod = e.ctrlKey || e.metaKey
  if (e.key === '/' && !mod) {
    e.preventDefault()
    void openFind()
    return
  }
  if (!id) return
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
  for (const n of nodes) ui.setNodePos(n.id, n.position)
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
])
</script>

<template>
  <section :aria-labelledby="`${FLOW_ID}-title`" class="flex min-h-0 flex-col">
    <h2 :id="`${FLOW_ID}-title`" class="sr-only">{{ t('map.title') }}</h2>
    <div
      ref="canvas"
      class="relative min-h-0 flex-1 overflow-hidden bg-surface"
      :class="nodeMotion ? 'ccm-map-motion' : ''"
      role="region"
      :aria-label="t(ui.mapView === 'timeline' ? 'tools.ariaLabel' : 'map.ariaLabel')"
      @keydown="onCanvasKey"
      @focusin="onCanvasFocusIn"
    >
      <ToolTimeline v-if="ui.mapView === 'timeline'" :terminal-id="terminalId" />
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
        :default-edge-options="{ type: 'smoothstep' }"
        class="h-full w-full"
      >
        <Background :gap="18" :size="1" pattern-color="var(--ccm-flow-dot)" />
        <template #node-agent="nodeProps">
          <AgentNode :id="nodeProps.id" :data="nodeProps.data" :picked="nodeProps.selected" />
        </template>
      </VueFlow>
      <p :id="`${FLOW_ID}-keys`" class="sr-only">{{ t('map.node.keys', NODE_KEYS) }}</p>
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
              :aria-pressed="settings.hideFinished"
              :aria-label="settings.hideFinished ? t('map.showFinished') : t('map.hideFinished')"
              :title="settings.hideFinished ? t('map.showFinished') : t('map.hideFinished')"
              :disabled="!hasNodes"
              @click="settings.toggleHideFinished()"
            >
              <component :is="settings.hideFinished ? EyeOff : Eye" :size="16" aria-hidden="true" />
              <span v-if="settings.hideFinished && visibility.hidden > 0" class="tabular-nums">{{ t('map.hiddenCount', { n: visibility.hidden }) }}</span>
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
