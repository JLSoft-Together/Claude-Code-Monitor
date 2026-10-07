<script setup lang="ts">
import ArtImage from './ArtImage.vue'
import { computed, nextTick, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Eye, EyeOff, LayoutGrid, Maximize, Minus, Plus } from 'lucide-vue-next'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { columnsFor, computeLayout, visibleAgents } from '../lib/layout'
import AgentDetails from './AgentDetails.vue'
import AgentNode from './AgentNode.vue'

const { t } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()
const settings = useSettingsStore()

const FLOW_ID = 'agent-map'
const { addNodes, removeNodes, getNodes, fitView, zoomIn, zoomOut, updateNode, onNodeClick, onNodeDragStop, onPaneClick, onNodesInitialized } = useVueFlow(FLOW_ID)

const canvas = ref<HTMLElement | null>(null)
const hasNodes = ref(false)
let didInitialFit = false
let pendingFit = false

const highlighted = computed(() => (ui.selectedAgentId ? agents.lineage(ui.selectedAgentId) : null))
provide('ccm-highlight', highlighted)

const visibility = computed(() => visibleAgents(agents.list, settings.hideFinished))
const shownList = computed(() => agents.list.filter((a) => visibility.value.visible.has(a.id)))
const shownByTerminal = computed(() => {
  const out: Record<string, typeof agents.list> = {}
  for (const [id, list] of Object.entries(agents.byTerminal)) {
    const kept = list.filter((a) => visibility.value.visible.has(a.id))
    if (kept.length) out[id] = kept
  }
  return out
})

const terminalOrder = computed(() =>
  [...terminals.list].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.id.localeCompare(b.id)),
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
    const position = ui.nodePos[id] ?? placed.get(id)
    if (!position) continue
    const node = current.get(id)
    if (!node) {
      fresh.push({ id, type: 'agent', position: { ...position }, data: { agentId: id }, draggable: true, selectable: false })
    } else if (node.position.x !== position.x || node.position.y !== position.y) {
      updateNode(id, { position: { ...position } })
    }
  }
  if (fresh.length) addNodes(fresh)
  hasNodes.value = agents.list.length > 0

  if (hasNodes.value && !didInitialFit) {
    didInitialFit = true
    pendingFit = true
  } else if (fit) {
    void nextTick(() => fitView({ padding: 0.2, duration: 250, maxZoom: 1.1 }))
  }
}

const edges = computed<Edge[]>(() =>
  shownList.value
    .filter((a) => a.parentId && visibility.value.visible.has(a.parentId))
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
// Collapsing a side panel resizes the canvas after the 200ms grid transition.
let resizeTimer: number | undefined
watch(
  () => ui.collapsed.join(','),
  () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => syncNodes(true), 240)
  },
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
  void fitView({ padding: 0.2, maxZoom: 1.1 })
})

watch(
  () => ui.selectedAgentId && !visibility.value.visible.has(ui.selectedAgentId),
  (lost) => {
    if (lost) ui.selectAgent(null)
  },
)

onNodeClick(({ node }) => ui.selectAgent(ui.selectedAgentId === node.id ? null : node.id))
onPaneClick(() => ui.selectAgent(null))
onNodeDragStop(({ nodes }) => {
  for (const n of nodes) ui.setNodePos(n.id, n.position)
})

const controls = computed(() => [
  { key: 'zoomIn', label: t('map.zoomIn'), icon: Plus, run: () => zoomIn({ duration: 150 }) },
  { key: 'zoomOut', label: t('map.zoomOut'), icon: Minus, run: () => zoomOut({ duration: 150 }) },
  { key: 'fit', label: t('map.fit'), icon: Maximize, run: () => fitView({ padding: 0.2, duration: 250, maxZoom: 1.1 }) },
  { key: 'reset', label: t('map.reset'), icon: LayoutGrid, run: () => ui.resetLayout() },
])
</script>

<template>
  <section aria-labelledby="map-title" class="flex min-h-0 flex-col">
    <div class="mb-3 flex items-center justify-between gap-2 px-0.5">
      <h2 id="map-title" class="text-sm font-semibold text-ink">{{ t('map.title') }}</h2>
      <div class="flex items-center gap-0.5" role="toolbar" :aria-label="t('map.title')">
        <button
          type="button"
          class="mr-1 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          :class="settings.hideFinished ? 'bg-raised text-ink' : 'text-ink-muted'"
          :aria-pressed="settings.hideFinished"
          :aria-label="settings.hideFinished ? t('map.showFinished') : t('map.hideFinished')"
          :title="settings.hideFinished ? t('map.showFinished') : t('map.hideFinished')"
          :disabled="!hasNodes"
          @click="settings.toggleHideFinished()"
        >
          <component :is="settings.hideFinished ? EyeOff : Eye" :size="17" aria-hidden="true" />
          <span v-if="settings.hideFinished && visibility.hidden > 0" class="tabular-nums">{{ t('map.hiddenCount', { n: visibility.hidden }) }}</span>
        </button>
        <button
          v-for="c in controls"
          :key="c.key"
          type="button"
          class="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          :aria-label="c.label"
          :title="c.label"
          :disabled="!hasNodes"
          @click="c.run()"
        >
          <component :is="c.icon" :size="17" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div
      ref="canvas"
      class="relative min-h-[440px] flex-1 overflow-hidden rounded-xl border border-line bg-surface lg:min-h-0"
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
        :default-edge-options="{ type: 'smoothstep' }"
        class="h-full w-full"
      >
        <Background :gap="18" :size="1" pattern-color="var(--ccm-flow-dot)" />
        <template #node-agent="nodeProps">
          <AgentNode :id="nodeProps.id" :data="nodeProps.data" />
        </template>
      </VueFlow>

      <div v-if="!hasNodes" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-sm text-ink-muted">
        <ArtImage name="agent-map-bg" class="w-full max-w-3xl opacity-25" />
        <p>{{ t('map.empty') }}</p>
      </div>

      <AgentDetails />
    </div>
  </section>
</template>
