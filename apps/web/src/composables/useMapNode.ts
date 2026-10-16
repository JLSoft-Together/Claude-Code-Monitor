import { computed, inject, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import type { PeerLinkKind } from '@ccm/shared'
import type { MapNodeContext } from '../lib/mapNav'
import { bootNodeDelay } from '../lib/motion'
import { isCodex } from '../lib/provider'
import { isQuiet, statusMeta } from '../lib/status'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'

export type PeerLane = 'ab' | 'ba'

export interface RunnerBudget {
  take(): boolean
  give(): void
}

export interface PeerEdgeData {
  linkId: string
  kind: PeerLinkKind
  a: string
  b: string
  opened?: { by: string; to: string }
}

export interface PeerMapContext {
  scoped: boolean
  rings: Readonly<Ref<Readonly<Record<string, number>>>>
  slots: Readonly<Ref<ReadonlyMap<string, { a: number; b: number }>>>
  listen(edgeId: string, fly: (lane: PeerLane, n: number) => void): () => void
  landed(terminalId: string): void
  goTo(terminalId: string): void
}

export const MAP_RUNNERS = 'ccm-map-runners'
export const PEER_MAP = 'ccm-peer-map'

export function useRunnerBudget(): RunnerBudget | null {
  return inject<RunnerBudget | null>(MAP_RUNNERS, null)
}

export function usePeerMap(): PeerMapContext | null {
  return inject<PeerMapContext | null>(PEER_MAP, null)
}

export function usePeerName(): (terminalId: string) => string {
  const agents = useAgentsStore()
  const terminals = useTerminalsStore()
  return (terminalId) => {
    const main = agents.mainOf(terminalId)
    return displayTitle(terminals.byId[terminalId]) || main?.name || main?.id || terminalId
  }
}

export function useMapNode(props: { id: string; data: { agentId: string } }) {
  const { t } = useI18n()
  const agents = useAgentsStore()
  const terminals = useTerminalsStore()
  const ui = useUiStore()
  const { id: flowId } = useVueFlow()
  const highlighted = inject<ComputedRef<Set<string> | null>>('ccm-highlight')
  const mapCtx = inject<MapNodeContext | null>('ccm-map-node', null)

  const agent = computed(() => agents.byId[props.data.agentId])
  const terminal = computed(() => (agent.value ? terminals.byId[agent.value.terminalId] : undefined))
  const meta = computed(() => statusMeta(agent.value?.status))
  const codex = computed(() => isCodex(agent.value))
  const selected = computed(() => ui.selectedAgentId === props.data.agentId)
  const quiet = computed(() => (agent.value ? isQuiet(agent.value.status) : false))
  const working = computed(() => agent.value?.status === 'working')
  const tabbable = computed(() => mapCtx?.tabStop.value === props.id)
  const findHit = computed(() => {
    const set = mapCtx?.matches.value
    if (!set) return null
    return mapCtx?.currentMatch.value === props.id ? 'current' : set.has(props.id) ? 'hit' : 'miss'
  })
  const dimmed = computed(() => {
    if (findHit.value === 'miss') return true
    const set = highlighted?.value
    return set ? !set.has(props.data.agentId) : false
  })
  const kids = computed(() => mapCtx?.children.value.get(props.id) ?? 0)
  const folded = computed(() => !!mapCtx?.collapsed.value.has(props.id))
  const foldedCount = computed(() => mapCtx?.hiddenUnder.value.get(props.id) ?? 0)
  const foldLabel = computed(() => (folded.value ? t('map.node.expand', { n: foldedCount.value }) : t('map.node.collapse', { n: kids.value })))

  const flash = ref(0)
  watch(
    () => agent.value?.status,
    (next, prev) => {
      if (prev && next !== prev) flash.value++
    },
  )

  const popDelay = bootNodeDelay()

  function toggleFold(): void {
    mapCtx?.toggleFold(props.id)
  }

  return {
    flowId,
    mapCtx,
    agent,
    terminal,
    meta,
    codex,
    selected,
    quiet,
    working,
    tabbable,
    findHit,
    dimmed,
    kids,
    folded,
    foldedCount,
    foldLabel,
    flash,
    popDelay,
    toggleFold,
  }
}
