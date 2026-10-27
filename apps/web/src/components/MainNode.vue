<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { ArrowRightLeft, ChevronDown, ChevronRight, CornerDownRight, Mail, Network, Send } from 'lucide-vue-next'
import { useMapNode, usePeerMap, usePeerName } from '../composables/useMapNode'
import { duration, now } from '../lib/format'
import { MAIN_HEIGHT, MAIN_WIDTH, TRUNK_X } from '../lib/layout'
import { effortLabel, modelLabel } from '../lib/model'
import { contextPctOf } from '../lib/provider'
import { displayTitle } from '../lib/title'
import { waitDisplay } from '../lib/wait'
import { useExtrasStore } from '../stores/extras'
import { usePeersStore } from '../stores/peers'
import { useUiStore } from '../stores/ui'
import ContextRing from './ContextRing.vue'
import ProviderBadge from './ProviderBadge.vue'
import StatusIcon from './StatusIcon.vue'
import TokenCount from './TokenCount.vue'

const props = defineProps<{ id: string; data: { agentId: string }; picked?: boolean }>()

const { t } = useI18n()
const ui = useUiStore()
const extras = useExtrasStore()
const { viewport, findNode, updateNode } = useVueFlow()
const { flowId, mapCtx, agent, terminal, meta, codex, selected, quiet, working, tabbable, findHit, dimmed, kids, folded, foldLabel, foldedCount, flash, popDelay, toggleFold } =
  useMapNode(props)

const title = computed(() => displayTitle(terminal.value) || agent.value?.name || agent.value?.id || '')
const attention = computed(() => terminal.value?.status === 'waiting' || agent.value?.status === 'waiting')
const wait = computed(() => (terminal.value?.status === 'waiting' ? waitDisplay(terminal.value.waitingFor, agent.value?.currentTool, t) : null))

const activity = computed(() => {
  const a = agent.value
  if (!a) return ''
  if (wait.value) return wait.value.reason === 'other' ? t('terminal.waitingFor', { reason: wait.value.text }) : wait.value.text
  if (a.currentTool && working.value) return t('terminal.running', { tool: a.currentTool })
  return t(meta.value.labelKey)
})
const elapsed = computed(() => (working.value || attention.value ? duration(terminal.value?.statusSince, now.value) : null))

const model = computed(() => modelLabel(agent.value?.model, agent.value?.contextWindow, extras.modelNames))
const effort = computed(() => effortLabel(agent.value?.effort, t))
const modelTitle = computed(() =>
  effort.value
    ? t('agent.modelEffortTitle', { model: agent.value?.model ?? '', effort: effort.value })
    : t('agent.modelTitle', { model: agent.value?.model ?? '' }),
)
const showContext = computed(() => {
  const a = agent.value
  return !!a && a.contextTokens !== undefined && !!a.contextWindow && a.status !== 'completed' && a.status !== 'cancelled'
})

const peers = usePeersStore()
const peerMap = usePeerMap()
const nameOf = usePeerName()
const terminalId = computed(() => agent.value?.terminalId ?? '')
const recent = computed(() => peers.recentOf(terminalId.value))
const role = computed(() => peers.roleOf(terminalId.value))

const peerNote = computed(() => {
  const r = recent.value
  const first = r?.others[0]
  if (!r || !first) return null
  const name = nameOf(first)
  if (r.kind === 'opened') return { icon: CornerDownRight, text: t('peer.openedBy', { name }), tone: 'text-ink-muted' }
  if (r.dir === 'both') return { icon: ArrowRightLeft, text: t('peer.talking', { name }), tone: 'text-peer' }
  const many = r.others.length
  if (r.dir === 'out') return { icon: Send, text: many > 1 ? t('peer.sentMany', { n: many }, many) : t('peer.sent', { name }), tone: 'text-peer' }
  return { icon: Mail, text: many > 1 ? t('peer.receivedMany', { n: many }, many) : t('peer.received', { name }), tone: 'text-peer' }
})
const ownerNeeded = computed(() => attention.value || agent.value?.status === 'error' || terminal.value?.status === 'error')
const peerLine = computed(() => (ownerNeeded.value ? null : peerNote.value))
const peerBadge = computed(() => (ownerNeeded.value ? peerNote.value : null))

const peerChip = computed(() => {
  const r = role.value
  const target = r.sentTo[0] ?? r.heardFrom[0]
  if (!target) return null
  const names = (ids: string[]) => ids.map(nameOf).join(', ')
  const lines = [
    ...(r.sentTo.length ? [t('peer.sentList', { names: names(r.sentTo) })] : []),
    ...(r.heardFrom.length ? [t('peer.heardList', { names: names(r.heardFrom) })] : []),
    ...(r.opened.length ? [t('peer.openedList', { names: names(r.opened) })] : []),
  ]
  const tip = lines.join('\n')
  if (r.coordinating >= 2) {
    const label = [t('peer.coordinatingLabel', { n: r.coordinating, names: names(r.sentTo) }, r.coordinating), ...lines.slice(1)].join('. ')
    return { key: 'coord', icon: Network, count: r.coordinating, target, tip, label }
  }
  return { key: r.sentTo.length ? 'sent' : 'heard', icon: r.sentTo.length ? Send : Mail, count: 0, target, tip, label: lines.join('. ') }
})

const ring = ref(0)
watch(
  () => (terminalId.value ? (peerMap?.rings.value[terminalId.value] ?? 0) : 0),
  (n, before) => {
    if (n > before) ring.value++
  },
)

const size = computed(() => ui.nodeSizes[props.id])
const frame = computed(() => ({ width: `${size.value?.w ?? MAIN_WIDTH}px`, height: `${Math.max(MAIN_HEIGHT, size.value?.h ?? 0)}px` }))
const sized = computed(() => !!size.value?.w || !!size.value?.h)
const box = ref<HTMLElement | null>(null)
const resizing = ref(false)

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: { dir: Dir; cls: string }[] = [
  { dir: 'n', cls: 'inset-x-3 -top-1 h-2 cursor-ns-resize' },
  { dir: 's', cls: 'inset-x-3 -bottom-1 h-2 cursor-ns-resize' },
  { dir: 'w', cls: 'inset-y-3 -left-1 w-2 cursor-ew-resize' },
  { dir: 'e', cls: 'inset-y-3 -right-1 w-2 cursor-ew-resize' },
  { dir: 'nw', cls: '-left-1.5 -top-1.5 size-3 cursor-nwse-resize' },
  { dir: 'ne', cls: '-right-1.5 -top-1.5 size-3 cursor-nesw-resize' },
  { dir: 'sw', cls: '-left-1.5 -bottom-1.5 size-3 cursor-nesw-resize' },
  { dir: 'se', cls: '-right-1.5 -bottom-1.5 size-3 cursor-nwse-resize' },
]
const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)))
let stop: (() => void) | null = null

function startResize(e: PointerEvent, dir: Dir): void {
  const el = box.value
  const node = findNode(props.id)
  if (!el || !node || e.button !== 0) return
  stop?.()
  const w0 = el.offsetWidth
  const h0 = el.offsetHeight
  const p0 = { ...node.position }
  const zoom = viewport.value.zoom || 1
  const sx = e.clientX
  const sy = e.clientY
  resizing.value = true
  let moved: { x: number; y: number } | null = null
  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / zoom
    const dy = (ev.clientY - sy) / zoom
    const next = { ...size.value }
    const pos = { ...p0 }
    if (dir.includes('e')) next.w = clamp(w0 + dx, 240, 720)
    if (dir.includes('w')) {
      next.w = clamp(w0 - dx, 240, 720)
      pos.x = p0.x + w0 - next.w
    }
    if (dir.includes('s')) next.h = clamp(h0 + dy, MAIN_HEIGHT, 480)
    if (dir.includes('n')) {
      next.h = clamp(h0 - dy, MAIN_HEIGHT, 480)
      pos.y = p0.y + h0 - next.h
    }
    ui.setNodeSize(props.id, next)
    if (pos.x !== p0.x || pos.y !== p0.y) updateNode(props.id, { position: pos })
    moved = pos.x !== p0.x || pos.y !== p0.y ? pos : null
  }
  const up = () => {
    stop?.()
    resizing.value = false
    if (moved && flowId === 'agent-map') ui.setNodePos(props.id, moved)
    ui.nodeResized++
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    stop = null
  }
}

function resetSize(): void {
  ui.setNodeSize(props.id, null)
  ui.nodeResized++
}

onBeforeUnmount(() => stop?.())
</script>

<template>
  <div v-if="agent" class="relative" :style="frame">
    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" :style="{ left: `${TRUNK_X}px` }" />
    <div class="ccm-node-in size-full" :style="popDelay ? { animationDelay: `${popDelay}ms` } : undefined">
      <div
        ref="box"
        data-agent-node
        data-node-kind="main"
        :tabindex="tabbable ? 0 : -1"
        role="group"
        :aria-roledescription="t('mapV53.node.main')"
        :aria-label="`${title} · ${t(meta.labelKey)}`"
        :aria-describedby="`${flowId}-keys`"
        class="group/node relative flex flex-col justify-between gap-1 rounded-card border bg-surface px-3 py-2.5 shadow-card transition-[opacity,border-color,box-shadow] duration-(--ccm-dur-base) ease-out-quint focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus"
        :style="frame"
        :class="[
          resizing ? 'border-focus' : '',
          selected ? 'border-focus ring-2 ring-focus' : attention ? 'border-st-waiting' : agent.status === 'error' ? 'border-st-error' : 'border-line',
          attention && !selected ? 'ccm-attention' : '',
          dimmed ? 'opacity-30' : '',
          picked ? 'outline-2 outline-offset-4 outline-focus outline-dashed' : '',
          findHit === 'current' && !selected ? 'ring-2 ring-accent' : findHit === 'hit' && !selected ? 'ring-1 ring-accent' : '',
        ]"
      >
        <span v-if="flash" :key="flash" class="ccm-flash pointer-events-none absolute inset-0 rounded-card" :class="meta.text" aria-hidden="true" />
        <span v-if="ring" :key="ring" class="ccm-peer-ring absolute -inset-px" aria-hidden="true" data-peer-ring />
        <div class="flex min-w-0 items-center gap-2">
          <span class="relative inline-flex shrink-0">
            <span :key="agent.status" class="ccm-glyph-pop inline-flex"><StatusIcon :status="agent.status" :size="16" /></span>
            <Transition name="ccm-peer-pip">
              <span
                v-if="peerBadge"
                class="absolute -top-1 -right-1.5 inline-flex size-3 items-center justify-center rounded-full bg-surface"
                role="img"
                :aria-label="peerBadge.text"
                :title="peerBadge.text"
                data-peer-badge
              >
                <component :is="peerBadge.icon" :size="9" :stroke-width="2.5" :class="peerBadge.tone" aria-hidden="true" />
              </span>
            </Transition>
          </span>
          <span
            class="nodrag min-w-0 flex-1 cursor-text text-[15px] leading-5 font-semibold select-text"
            :class="[sized ? 'break-words' : 'truncate', quiet ? 'text-ink-muted' : 'text-ink']"
            :title="title"
          >
            {{ title }}
          </span>
          <ProviderBadge v-if="codex" :mode="terminal?.entrypoint ?? agent.type" variant="short" />
          <span :key="agent.status" class="ccm-swap-in shrink-0 rounded-full px-2 py-px text-2xs font-semibold" :class="[meta.soft, meta.text]">{{ t(meta.labelKey) }}</span>
        </div>
        <div class="flex min-w-0 items-center gap-2 text-xs">
          <span v-if="model" class="nodrag min-w-0 flex-1 cursor-text truncate text-ink-muted select-text" :title="modelTitle">
            {{ model }}<span v-if="effort" class="text-ink-faint"> · {{ effort }}</span>
          </span>
          <span v-else class="flex-1" />
          <Transition name="ccm-swap" mode="out-in">
            <button
              v-if="peerChip"
              :key="peerChip.key"
              type="button"
              tabindex="-1"
              class="nodrag nopan inline-flex h-5 max-w-28 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-fill px-1.5 text-2xs font-medium text-ink-muted transition-colors hover:bg-fill-strong hover:text-ink"
              :aria-label="peerChip.label"
              :title="peerChip.tip"
              data-peer-chip
              @pointerdown.stop
              @click.stop="peerMap?.goTo(peerChip.target)"
            >
              <component :is="peerChip.icon" :size="12" class="shrink-0" aria-hidden="true" />
              <span v-if="peerChip.count" class="tabular-nums">{{ peerChip.count }}</span>
            </button>
          </Transition>
          <ContextRing v-if="showContext" :tokens="agent.contextTokens ?? 0" :window="agent.contextWindow ?? 0" :pct="contextPctOf(agent)" />
          <TokenCount v-if="agent.totalTokens !== undefined" delta="none" class="font-semibold text-ink" :value="agent.totalTokens" />
        </div>
        <div class="flex min-w-0 items-center gap-1.5 text-xs" :class="working || attention ? 'text-ink' : 'text-ink-muted'">
          <component :is="wait.icon" v-if="wait && wait.reason !== 'other'" :size="13" class="shrink-0 text-st-waiting" aria-hidden="true" />
          <span
            v-if="peerLine"
            :key="`peer:${peerLine.text}`"
            class="ccm-swap-in nodrag flex min-w-0 flex-1 cursor-text items-center gap-1.5 text-ink select-text"
            :title="peerLine.text"
            data-peer-line
          >
            <component :is="peerLine.icon" :size="13" class="shrink-0" :class="peerLine.tone" aria-hidden="true" />
            <span class="truncate">{{ peerLine.text }}</span>
          </span>
          <span v-else :key="activity" class="ccm-swap-in nodrag min-w-0 flex-1 cursor-text truncate select-text" :title="activity">{{ activity }}</span>
          <span v-if="elapsed" class="shrink-0 tabular-nums text-ink-faint">{{ elapsed }}</span>
        </div>
        <button
          v-if="mapCtx && (kids > 0 || folded)"
          type="button"
          tabindex="-1"
          data-fold
          class="nodrag nopan absolute -bottom-2.5 left-7 z-20 inline-flex h-5 cursor-pointer items-center gap-0.5 rounded-full border border-line bg-surface px-1 text-2xs font-medium text-ink-muted shadow-card transition-opacity hover:text-ink"
          :class="folded ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100 group-focus-visible/node:opacity-100'"
          :aria-expanded="!folded"
          :aria-label="foldLabel"
          :title="foldLabel"
          @pointerdown.stop
          @click.stop="toggleFold()"
        >
          <component :is="folded ? ChevronRight : ChevronDown" :size="12" aria-hidden="true" />
          <span v-if="folded" class="tabular-nums">{{ t('map.node.hidden', { n: foldedCount }) }}</span>
        </button>
        <span
          v-for="h in HANDLES"
          :key="h.dir"
          class="nodrag nopan absolute z-10 rounded-sm opacity-0 transition-opacity group-hover/node:opacity-100"
          :class="[h.cls, h.dir.length === 2 ? 'border border-accent bg-surface' : 'hover:bg-accent/40']"
          :title="t('map.resizeHint')"
          aria-hidden="true"
          @pointerdown.stop.prevent="startResize($event, h.dir)"
          @dblclick.stop="resetSize"
          @click.stop
        />
      </div>
    </div>
  </div>
</template>

<style>
.ccm-peer-pip-enter-active {
  transition:
    opacity var(--ccm-dur-fast) var(--ease-out-quint),
    scale var(--ccm-dur-base) var(--ease-spring);
}
.ccm-peer-pip-leave-active {
  transition: opacity var(--ccm-dur-fast) var(--ease-exit);
}
.ccm-peer-pip-enter-from {
  opacity: 0;
  scale: 0.4;
}
.ccm-peer-pip-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .ccm-peer-pip-enter-from {
    scale: 1;
  }
}
</style>
