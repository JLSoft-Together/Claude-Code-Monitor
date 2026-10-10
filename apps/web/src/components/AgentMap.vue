<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed, nextTick, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Eye, EyeOff, LayoutGrid, Maximize, Minus, PanelLeft, PanelRight, Plus, X } from 'lucide-vue-next'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { columnsFor, computeLayout, visibleAgents } from '../lib/layout'
import AgentDetails from './AgentDetails.vue'
import AgentNode from './AgentNode.vue'
import KeyHint from './KeyHint.vue'

const props = defineProps<{ terminalId?: string | null }>()
const { t } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()
const settings = useSettingsStore()

const scoped = !!props.terminalId
const FLOW_ID = scoped ? `agent-map-${props.terminalId}` : 'agent-map'
const { addNodes, removeNodes, getNodes, fitView, getViewport, setViewport, zoomIn, zoomOut, updateNode, onNodeClick, onNodeDragStop, onPaneClick, onNodesInitialized } = useVueFlow(FLOW_ID)

const canvas = ref<HTMLElement | null>(null)
const picked = ref<Set<string>>(new Set())
const hasNodes = ref(false)
let didInitialFit = false
let pendingFit = false

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

  const stale = [...current.keys()].filter((id) => !wanted.has(id))
  if (stale.length) removeNodes(stale)

  const fresh: Node[] = []
  for (const id of wanted) {
    const position = (scoped ? undefined : ui.nodePos[id]) ?? placed.get(id)
    if (!position) continue
    const node = current.get(id)
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
    void nextTick(() => autoFit(250))
  }
}

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

const edges = computed<Edge[]>(() =>
  shownList.value
    .filter((a) => a.parentId && visibility.value.visible.has(a.parentId) && nodeIds.value.has(a.id) && nodeIds.value.has(a.parentId))
    .map((a) => ({
      id: `${a.parentId}->${a.id}`,
      source: a.parentId!,
      target: a.id,
      type: 'smoothstep',
      class: a.status === 'working' ? 'ccm-edge-hot' : undefined,
      selectable: false,
      pathOptions: { borderRadius: 6 },
    })),
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
  () => void fitView({ padding: 0.2, duration: 250, maxZoom: 1.1 }),
)
watch(
  () => ui.focusRequest,
  () => {
    const id = ui.focusedTerminalId
    if (!id) return
    const ids = (shownByTerminal.value[id] ?? []).map((a) => a.id)
    if (ids.length) void fitView({ nodes: ids, padding: 0.35, duration: 300, maxZoom: 1.1 })
  },
)

onNodesInitialized(() => {
  if (!pendingFit) return
  pendingFit = false
  void autoFit()
})

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
onPaneClick(() => {
  ui.selectAgent(null)
  clearPicked()
})
onNodeDragStop(({ nodes }) => {
  if (scoped) return
  for (const n of nodes) ui.setNodePos(n.id, n.position)
})

const TOOL =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

const controls = computed<{ key: string; label: string; icon: typeof Plus; hint?: string; run: () => unknown }[]>(() => [
  { key: 'zoomIn', label: t('map.zoomIn'), icon: Plus, run: () => zoomIn({ duration: 150 }) },
  { key: 'zoomOut', label: t('map.zoomOut'), icon: Minus, run: () => zoomOut({ duration: 150 }) },
  { key: 'fit', label: t('map.fit'), icon: Maximize, hint: 'F', run: () => ui.requestFit() },
  { key: 'reset', label: t('map.reset'), icon: LayoutGrid, run: () => ui.resetLayout() },
])
</script>

<template>
  <section :aria-labelledby="`${FLOW_ID}-title`" class="flex min-h-0 flex-col">
    <h2 :id="`${FLOW_ID}-title`" class="sr-only">{{ t('map.title') }}</h2>
    <div
      ref="canvas"
      class="relative min-h-0 flex-1 overflow-hidden bg-surface"
      role="region"
      :aria-label="t('map.ariaLabel')"
    >
      <VueFlow
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

      <div v-if="!hasNodes" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-sm text-ink-muted">
        <ArtImage name="agent-map-bg" class="w-full max-w-3xl opacity-25" />
        <p>{{ t('map.empty') }}</p>
      </div>

      <div class="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
        <button
          type="button"
          :class="[TOOL, ui.isCollapsed('sessions') ? '' : 'invisible']"
          class="pointer-events-auto border border-line bg-surface/95 shadow-sm"
          :aria-label="t('map.showSessions')"
          :title="t('map.showSessions')"
          aria-keyshortcuts="S"
          @click="ui.togglePanel('sessions')"
        >
          <PanelLeft :size="16" aria-hidden="true" /><span class="hidden sm:inline">{{ ui.sessionTab ? t('panel.session') : t('sessions.title') }}</span><KeyHint keys="S" />
        </button>

        <div class="pointer-events-auto flex flex-wrap items-center justify-center gap-0.5 rounded-lg border border-line bg-surface/95 p-0.5 shadow-sm" role="toolbar" :aria-label="t('map.title')">
          <button
            v-if="picked.size"
            type="button"
            :class="TOOL"
            class="bg-raised text-ink"
            :aria-label="t('map.clearPicked')"
            :title="t('map.clearPicked')"
            @click="clearPicked()"
          >
            <span class="tabular-nums">{{ t('map.picked', { n: picked.size }) }}</span>
            <X :size="15" aria-hidden="true" />
          </button>
          <button
            type="button"
            :class="[TOOL, settings.hideFinished ? 'bg-raised text-ink' : '']"
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
        </div>

        <button
          type="button"
          :class="[TOOL, ui.isCollapsed('activity') ? '' : 'invisible']"
          class="pointer-events-auto border border-line bg-surface/95 shadow-sm"
          :aria-label="t('map.showActivity')"
          :title="t('map.showActivity')"
          aria-keyshortcuts="A"
          @click="ui.togglePanel('activity')"
        >
          <span class="hidden sm:inline">{{ t('activity.title') }}</span><KeyHint keys="A" /><PanelRight :size="16" aria-hidden="true" />
        </button>
      </div>

      <AgentDetails :flow-id="FLOW_ID" />
    </div>
  </section>
</template>
