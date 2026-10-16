<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { EdgeLabelRenderer, type GraphNode } from '@vue-flow/core'
import { usePeerMap, usePeerName, useRunnerBudget, type PeerEdgeData, type PeerLane } from '../composables/useMapNode'
import { now, relativeTime } from '../lib/format'
import { MAIN_HEIGHT, MAIN_WIDTH, peerPath, type Box } from '../lib/layout'
import { reducedMotion } from '../lib/motion'
import { usePeersStore } from '../stores/peers'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id: string
  sourceNode: GraphNode
  targetNode: GraphNode
  data: PeerEdgeData
}>()

const FLY_MS = 700
const HOT_MS = 1200

const { t, locale } = useI18n()
const peers = usePeersStore()
const ctx = usePeerMap()
const runners = useRunnerBudget()
const nameOf = usePeerName()

const boxOf = (n: GraphNode): Box => ({
  x: n.computedPosition.x,
  y: n.computedPosition.y,
  w: n.dimensions.width || MAIN_WIDTH,
  h: n.dimensions.height || MAIN_HEIGHT,
})
const arc = computed(() => peerPath(boxOf(props.sourceNode), boxOf(props.targetNode), ctx?.slots.value.get(props.id)))

const pathEl = ref<SVGPathElement | null>(null)
const hover = ref(false)
const hot = ref(false)
const envelopes = ref<Partial<Record<PeerLane, { x: number; y: number; n: number }>>>({})
const lanes: Record<PeerLane, { frame: number; holding: boolean; pending: number }> = {
  ab: { frame: 0, holding: false, pending: 0 },
  ba: { frame: 0, holding: false, pending: 0 },
}
let hotTimer = 0

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)

function heat(): void {
  hot.value = true
  window.clearTimeout(hotTimer)
  hotTimer = window.setTimeout(() => (hot.value = false), HOT_MS)
}

function land(lane: PeerLane): void {
  ctx?.landed(lane === 'ab' ? props.data.b : props.data.a)
}

function drop(lane: PeerLane): void {
  const next = { ...envelopes.value }
  delete next[lane]
  envelopes.value = next
}

function launch(lane: PeerLane, n: number): void {
  const l = lanes[lane]
  const el = pathEl.value
  heat()
  if (!el || !el.getTotalLength() || reducedMotion() || (runners && !runners.take())) {
    land(lane)
    return
  }
  l.holding = true
  const t0 = performance.now()
  const step = (at: number) => {
    const k = Math.min(1, (at - t0) / FLY_MS)
    const len = el.getTotalLength()
    const p = el.getPointAtLength(len * (lane === 'ab' ? ease(k) : 1 - ease(k)))
    envelopes.value = { ...envelopes.value, [lane]: { x: p.x, y: p.y, n } }
    if (k < 1) {
      l.frame = requestAnimationFrame(step)
      return
    }
    l.holding = false
    runners?.give()
    drop(lane)
    land(lane)
    if (l.pending) {
      const rest = l.pending
      l.pending = 0
      launch(lane, rest)
    }
  }
  l.frame = requestAnimationFrame(step)
}

function fly(lane: PeerLane, n: number): void {
  if (n <= 0) return
  const l = lanes[lane]
  if (l.holding) {
    l.pending += n
    heat()
    return
  }
  launch(lane, n)
}

let unlisten: (() => void) | null = null
onMounted(() => {
  unlisten = ctx?.listen(props.id, fly) ?? null
})
onBeforeUnmount(() => {
  unlisten?.()
  window.clearTimeout(hotTimer)
  for (const l of Object.values(lanes)) {
    cancelAnimationFrame(l.frame)
    if (l.holding) runners?.give()
    l.holding = false
  }
})

const link = computed(() => peers.list.find((l) => l.id === props.data.linkId))
const badge = computed(() => {
  const l = link.value
  const a = nameOf(props.data.a)
  const b = nameOf(props.data.b)
  const parts: string[] = []
  if (props.data.kind === 'message' && l) {
    if (l.ab > 0) parts.push(t('peer.edgeCount', { from: a, to: b, n: l.ab }))
    if (l.ba > 0) parts.push(t('peer.edgeCount', { from: b, to: a, n: l.ba }))
    const ago = relativeTime(l.lastAt, locale.value, now.value)
    if (ago) parts.push(t('peer.lastAt', { ago }))
  }
  const opened = props.data.kind === 'opened' ? { by: props.data.a, to: props.data.b } : props.data.opened
  if (opened) parts.push(t('peer.activityOpened', { from: nameOf(opened.by), to: nameOf(opened.to) }))
  return parts.join(' · ')
})
</script>

<template>
  <g class="ccm-peer-edge" :class="[data.kind === 'opened' ? 'ccm-peer-edge-opened' : '', hot ? 'ccm-peer-edge-hot' : '']" :data-peer-edge="data.linkId">
    <path ref="pathEl" class="ccm-peer-edge-line" :d="arc.d" fill="none" />
    <path class="ccm-peer-edge-hit" :d="arc.d" fill="none" @pointerenter="hover = true" @pointerleave="hover = false" />
    <g
      v-for="(f, lane) in envelopes"
      :key="lane"
      class="pointer-events-none"
      :transform="`translate(${f!.x} ${f!.y})`"
      aria-hidden="true"
      data-peer-envelope
    >
      <rect x="-5" y="-3.5" width="10" height="7" rx="1.5" class="fill-peer" />
      <path d="M -3.4 -1.9 L 0 0.7 L 3.4 -1.9" class="ccm-peer-envelope-v" fill="none" />
      <text v-if="f!.n > 1" x="7.5" y="-3.5" class="ccm-peer-envelope-n fill-ink">×{{ f!.n }}</text>
    </g>
  </g>
  <EdgeLabelRenderer>
    <Transition name="ccm-peer-badge">
      <div
        v-if="hover && badge"
        class="ccm-peer-edge-badge pointer-events-none absolute rounded-control border border-line bg-surface px-2 py-1 text-2xs whitespace-nowrap text-ink tabular-nums shadow-pop"
        :style="{ transform: `translate(-50%, -100%) translate(${arc.mid.x}px, ${arc.mid.y - 6}px)` }"
        aria-hidden="true"
        data-peer-badge
      >
        {{ badge }}
      </div>
    </Transition>
  </EdgeLabelRenderer>
</template>

<style>
@keyframes ccm-peer-edge-in {
  from {
    opacity: 0;
  }
}

.ccm-peer-edge {
  animation: ccm-peer-edge-in var(--ccm-dur-slow) var(--ease-out-quint) backwards;
  transition: opacity var(--ccm-dur-slow) var(--ease-exit);
}

.vue-flow__edge.ccm-peer-leaving .ccm-peer-edge {
  opacity: 0;
}

.ccm-peer-edge-line {
  stroke: var(--ccm-ink-faint);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  transition: stroke var(--ccm-dur-slow) var(--ease-exit);
}

.ccm-peer-edge-opened .ccm-peer-edge-line {
  stroke-width: 1.5;
  stroke-dasharray: 0.1 4;
  stroke-linecap: round;
}

.ccm-peer-edge-hot .ccm-peer-edge-line {
  stroke: var(--ccm-peer);
  transition: stroke var(--ccm-dur-fast) var(--ease-out-quint);
}

.ccm-peer-edge-hit {
  stroke: transparent;
  stroke-width: 12;
  pointer-events: stroke;
  cursor: default;
}

.ccm-peer-envelope-v {
  stroke: var(--ccm-surface);
  stroke-width: 1;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ccm-peer-envelope-n {
  font-size: 9px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.ccm-peer-badge-enter-active {
  transition: opacity var(--ccm-dur-fast) var(--ease-out-quint);
}

.ccm-peer-badge-leave-active {
  transition: opacity 100ms var(--ease-exit);
}

.ccm-peer-badge-enter-from,
.ccm-peer-badge-leave-to {
  opacity: 0;
}
</style>
