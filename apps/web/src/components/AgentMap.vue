<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ChartGantt, Eye, EyeOff, LayoutGrid, Maximize, Minus, Network, PanelLeft, PanelRight, Plus, X } from 'lucide-vue-next'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { useSettingsStore } from '../stores/settings'
import { useUiStore, type MapView } from '../stores/ui'
import { columnsFor, computeLayout, visibleAgents } from '../lib/layout'
import { motionMs, nextMapIsSwitch, reducedMotion, retireOverlay } from '../lib/motion'
import { WINDOWS } from '../lib/toolTimeline'
import AgentContextMenu from './AgentContextMenu.vue'
import AgentDetails from './AgentDetails.vue'
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
const { addNodes, removeNodes, getNodes, fitView, getViewport, setViewport, zoomIn, zoomOut, updateNode, onNodeClick, onNodeContextMenu, onNodeDragStop, onPaneClick, onNodesInitialized } = useVueFlow(FLOW_ID)

const canvas = ref<HTMLElement | null>(null)
const picked = ref<Set<string>>(new Set())
const hasNodes = ref(false)
let didInitialFit = false
let pendingFit = false
const flyIn = nextMapIsSwitch()

const highlighted = computed(() => (ui.selectedAgentId ? agents.lineage(ui.selectedAgentId) : null))
provide('ccm-highlight', highlighted)

const source = computed(() => (props.terminalId ? (agents.byTerminal[props.terminalId] ?? []) : agents.list))
const visibility = computed(() => visibleAgents(source.value, settings.hideFinished))
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

onNodeClick(({ node, event }) => {
  const terminalId = agents.byId[node.id]?.terminalId
  if (!scoped && terminalId && (event.ctrlKey || event.metaKey || event.shiftKey)) {
    togglePicked(terminalId)
    return
  }
  const selecting = ui.selectedAgentId !== node.id
  ui.selectAgent(selecting ? node.id : null)
  if (selecting && terminalId) ui.revealTerminal(terminalId)
})
// Right-click (or the menu key / Shift+F10 on a focused node): session actions, incl. its workspace pane.
const ctxMenu = ref<{ at: DOMRect; terminalId: string; agentId: string; trigger: HTMLElement | null } | null>(null)
function openContextMenu(agentId: string, at: DOMRect, trigger: HTMLElement | null): void {
  const terminalId = agents.byId[agentId]?.terminalId
  if (!terminalId) return
  if (ui.selectedAgentId !== agentId) {
    ui.selectAgent(agentId)
    ui.revealTerminal(terminalId)
  }
  ctxMenu.value = { at, terminalId, agentId, trigger }
}
onNodeContextMenu(({ node, event }) => {
  event.preventDefault()
  const p = 'clientX' in event ? event : event.touches[0]
  if (!p) return
  const el = (event.target as HTMLElement | null)?.closest<HTMLElement>('.vue-flow__node') ?? null
  openContextMenu(node.id, new DOMRect(p.clientX, p.clientY, 0, 0), el)
})
function onCanvasKey(e: KeyboardEvent): void {
  if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
  const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.vue-flow__node')
  const id = el?.dataset.id
  if (!el || !id) return
  e.preventDefault()
  openContextMenu(id, el.getBoundingClientRect(), el)
}
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
      <Teleport to="body">
        <Transition name="ccm-menu" @before-leave="retireOverlay">
          <AgentContextMenu
            v-if="ctxMenu"
            :at="ctxMenu.at"
            :terminal-id="ctxMenu.terminalId"
            :agent-id="ctxMenu.agentId"
            :trigger="ctxMenu.trigger"
            @close="ctxMenu = null"
          />
        </Transition>
      </Teleport>

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
