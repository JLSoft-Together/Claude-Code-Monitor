<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { compactNumber, fullNumber } from '../lib/format'
import { effortLabel, modelLabel } from '../lib/model'
import { isQuiet, statusMeta } from '../lib/status'
import { displayTitle } from '../lib/title'
import { MAIN_WIDTH, SUB_WIDTH } from '../lib/layout'
import { useAgentsStore } from '../stores/agents'
import { useExtrasStore } from '../stores/extras'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import ContextGauge from './ContextGauge.vue'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ id: string; data: { agentId: string }; picked?: boolean }>()

const { t, locale } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()
const extras = useExtrasStore()
const { id: flowId, viewport, findNode, updateNode } = useVueFlow()
const highlighted = inject<ComputedRef<Set<string> | null>>('ccm-highlight')

const agent = computed(() => agents.byId[props.data.agentId])
const isMain = computed(() => agent.value?.role === 'main')
const meta = computed(() => statusMeta(agent.value?.status))
const terminal = computed(() => (agent.value ? terminals.byId[agent.value.terminalId] : undefined))
const selected = computed(() => ui.selectedAgentId === props.data.agentId)
const dimmed = computed(() => {
  const set = highlighted?.value
  return set ? !set.has(props.data.agentId) : false
})
const quiet = computed(() => (agent.value ? isQuiet(agent.value.status) : false))
const working = computed(() => agent.value?.status === 'working')

const flash = ref(0)
watch(
  () => agent.value?.status,
  (next, prev) => {
    if (prev && next !== prev) flash.value++
  },
)

const title = computed(() => {
  const a = agent.value
  if (!a) return ''
  return isMain.value ? displayTitle(terminal.value) || a.name || a.id : a.type ?? a.name ?? t('agent.subagent')
})

const subtitle = computed(() => {
  const a = agent.value
  if (!a) return ''
  if (a.currentTool && (a.status === 'working' || a.status === 'waiting')) return t('terminal.running', { tool: a.currentTool })
  if (isMain.value && terminal.value?.status === 'waiting' && terminal.value.waitingFor) {
    return t('terminal.waitingFor', { reason: terminal.value.waitingFor })
  }
  if (!isMain.value && a.description) return a.description
  return t(meta.value.labelKey)
})

const model = computed(() => modelLabel(agent.value?.model, agent.value?.contextWindow, extras.modelNames))
const effort = computed(() => effortLabel(agent.value?.effort, t))
const modelTitle = computed(() =>
  effort.value
    ? t('agent.modelEffortTitle', { model: agent.value?.model ?? '', effort: effort.value })
    : t('agent.modelTitle', { model: agent.value?.model ?? '' }),
)

const tokens = computed(() => {
  const a = agent.value
  if (!a || a.totalTokens === undefined) return null
  return {
    total: compactNumber(a.totalTokens, locale.value),
    input: compactNumber(a.inputTokens ?? 0, locale.value),
    output: compactNumber(a.outputTokens ?? 0, locale.value),
    title: t('terminal.tokensTitle', {
      input: fullNumber(a.inputTokens, locale.value),
      output: fullNumber(a.outputTokens, locale.value),
      cache: fullNumber(a.cacheReadTokens, locale.value),
    }),
  }
})

const size = computed(() => ui.nodeSizes[props.id])
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
  // Height is a min-height, so the box can never be shorter than its content.
  const prevMin = el.style.minHeight
  el.style.minHeight = ''
  const natural = el.offsetHeight
  el.style.minHeight = prevMin
  const p0 = { ...node.position }
  const zoom = viewport.value.zoom || 1
  const sx = e.clientX
  const sy = e.clientY
  const minW = isMain.value ? 220 : 200
  resizing.value = true
  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / zoom
    const dy = (ev.clientY - sy) / zoom
    const next = { ...size.value }
    const pos = { ...p0 }
    if (dir.includes('e')) next.w = clamp(w0 + dx, minW, 720)
    if (dir.includes('w')) {
      next.w = clamp(w0 - dx, minW, 720)
      pos.x = p0.x + w0 - next.w
    }
    if (dir.includes('s')) next.h = clamp(h0 + dy, natural, 640)
    if (dir.includes('n')) {
      next.h = clamp(h0 - dy, natural, 640)
      pos.y = p0.y + h0 - next.h
    }
    ui.setNodeSize(props.id, next)
    if (pos.x !== p0.x || pos.y !== p0.y) updateNode(props.id, { position: pos })
    moved = pos.x !== p0.x || pos.y !== p0.y ? pos : null
  }
  let moved: { x: number; y: number } | null = null
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
  <div v-if="agent" class="ccm-pop">
    <div
      ref="box"
      class="group/node relative rounded-xl border bg-surface transition-[opacity,border-color,box-shadow] duration-200"
      :style="{ width: `${size?.w ?? (isMain ? MAIN_WIDTH : SUB_WIDTH)}px`, minHeight: size?.h ? `${size.h}px` : undefined }"
      :class="[
        isMain ? 'px-3.5 py-3' : 'px-3 py-2.5',
        resizing ? 'border-accent' : '',
        selected ? 'border-accent shadow-[0_0_0_3px_var(--ccm-accent-soft)]' : working || agent.status === 'waiting' || agent.status === 'error' ? meta.border : 'border-line',
        working && !selected ? 'ccm-breathe' : '',
        quiet && !selected ? 'opacity-60' : '',
        dimmed ? 'opacity-30' : '',
        picked ? 'outline-2 outline-offset-4 outline-accent outline-dashed' : '',
      ]"
    >
      <span v-if="flash" :key="flash" class="ccm-flash pointer-events-none absolute inset-0 rounded-xl" :class="meta.text" aria-hidden="true" />
      <Handle type="target" :position="Position.Left" />
      <div class="flex items-center gap-2">
        <StatusIcon :status="agent.status" :size="isMain ? 16 : 14" />
        <span class="min-w-0 flex-1 font-semibold" :class="[isMain ? 'text-base' : 'text-sm', sized ? 'break-words' : 'truncate']" :title="title">
          {{ title }}
        </span>
        <span v-if="isMain" class="shrink-0 rounded-md bg-raised px-1.5 py-px text-2xs font-medium text-ink-muted">
          {{ t('agent.main') }}
        </span>
      </div>
      <div class="mt-1 flex min-w-0 items-center gap-2 text-xs">
        <p class="min-w-0 flex-1" :class="[working ? 'text-ink' : 'text-ink-muted', sized ? 'break-words' : 'truncate']" :title="subtitle">
          <span class="sr-only">{{ t(meta.labelKey) }} · </span>{{ subtitle }}
        </p>
        <span
          v-if="model"
          class="shrink-0 rounded-md border border-line px-1.5 py-px text-2xs font-medium text-ink-muted"
          :title="modelTitle"
        >
          {{ model }}<span v-if="effort" class="text-ink-faint"> · {{ effort }}</span>
        </span>
      </div>
      <div
        v-if="tokens"
        class="mt-2 flex items-center gap-2 border-t border-line pt-2 text-xs tabular-nums text-ink-muted"
        :title="tokens.title"
      >
        <span class="font-semibold text-ink">{{ t('terminal.tokens', { total: tokens.total }) }}</span>
        <span class="ml-auto inline-flex items-center gap-1">
          <span class="size-1.5 rounded-full bg-series-input" aria-hidden="true" />{{ t('agent.inShort', { n: tokens.input }) }}
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="size-1.5 rounded-full bg-series-output" aria-hidden="true" />{{ t('agent.outShort', { n: tokens.output }) }}
        </span>
      </div>
      <ContextGauge
        v-if="agent.contextTokens !== undefined && agent.contextWindow && agent.status !== 'completed' && agent.status !== 'cancelled'"
        class="mt-2"
        compact
        :tokens="agent.contextTokens"
        :window="agent.contextWindow"
      />
      <Handle type="source" :position="Position.Bottom" />
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
</template>
