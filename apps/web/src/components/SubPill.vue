<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useMapNode } from '../composables/useMapNode'
import { compactNumber, duration, now } from '../lib/format'
import { PILL_HEIGHT, PILL_WIDTH, TRUNK_X } from '../lib/layout'
import { effortLabel, modelLabel } from '../lib/model'
import { useExtrasStore } from '../stores/extras'
import ProviderBadge from './ProviderBadge.vue'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ id: string; data: { agentId: string }; picked?: boolean }>()

const { t, locale } = useI18n()
const extras = useExtrasStore()
const { flowId, mapCtx, agent, meta, codex, selected, quiet, working, tabbable, findHit, dimmed, kids, folded, foldLabel, foldedCount, flash, popDelay, toggleFold } =
  useMapNode(props)

const name = computed(() => {
  const a = agent.value
  if (!a) return ''
  if (codex.value) return a.name ?? t('agent.codexRun')
  return a.type ?? a.name ?? t('agent.subagent')
})

const detail = computed(() => {
  const a = agent.value
  if (!a) return ''
  if (a.currentTool && (working.value || a.status === 'waiting')) return a.currentTool
  return a.description ?? t(meta.value.labelKey)
})

const elapsed = computed(() => {
  const a = agent.value
  if (!a?.startedAt || a.status === 'error') return null
  if (working.value || a.status === 'waiting') return duration(a.startedAt, now.value)
  if (a.completedAt) return duration(a.startedAt, Date.parse(a.completedAt))
  return null
})

const edge = computed(() => {
  const s = agent.value?.status
  if (selected.value) return 'border-focus ring-2 ring-focus'
  if (s === 'working' || s === 'waiting' || s === 'error') return meta.value.border
  return 'border-line'
})

const tip = computed(() => {
  const a = agent.value
  if (!a) return ''
  const lines = [`${name.value} · ${t(meta.value.labelKey)}`]
  if (a.description) lines.push(a.description)
  if (a.currentTool && working.value) lines.push(t('terminal.running', { tool: a.currentTool }))
  const model = modelLabel(a.model, a.contextWindow, extras.modelNames)
  const effort = effortLabel(a.effort, t)
  if (model) lines.push(effort ? `${model} · ${effort}` : model)
  if (a.totalTokens !== undefined)
    lines.push(
      `${t('terminal.tokens', { total: compactNumber(a.totalTokens, locale.value) })} · ${t('agent.inShort', { n: compactNumber(a.inputTokens ?? 0, locale.value) })} · ${t('agent.outShort', { n: compactNumber(a.outputTokens ?? 0, locale.value) })}`,
    )
  return lines.join('\n')
})
</script>

<template>
  <div v-if="agent" class="relative" :style="{ width: `${PILL_WIDTH}px`, height: `${PILL_HEIGHT}px` }">
    <Handle type="target" :position="Position.Top" :style="{ left: `${TRUNK_X}px` }" />
    <Handle type="source" :position="Position.Bottom" :style="{ left: `${TRUNK_X}px` }" />
    <div class="ccm-pill-in size-full" :style="popDelay ? { animationDelay: `${popDelay}ms` } : undefined">
      <div
        data-agent-node
        data-node-kind="sub"
        :tabindex="tabbable ? 0 : -1"
        role="group"
        :aria-roledescription="t('mapV53.node.sub')"
        :aria-label="`${name} · ${t(meta.labelKey)}`"
        :aria-describedby="`${flowId}-keys`"
        class="group/node relative flex items-center gap-1.5 rounded-full border bg-surface pr-3 pl-3 text-xs transition-[opacity,border-color,box-shadow] duration-(--ccm-dur-base) ease-out-quint focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus"
        :style="{ width: `${PILL_WIDTH}px`, height: `${PILL_HEIGHT}px` }"
        :class="[
          edge,
          quiet && !selected ? 'text-ink-muted' : 'text-ink',
          dimmed ? 'opacity-30' : '',
          picked ? 'outline-2 outline-offset-4 outline-focus outline-dashed' : '',
          findHit === 'current' && !selected ? 'ring-2 ring-accent' : findHit === 'hit' && !selected ? 'ring-1 ring-accent' : '',
        ]"
        :title="tip"
      >
        <span v-if="flash" :key="flash" class="ccm-flash pointer-events-none absolute inset-0 rounded-full" :class="meta.text" aria-hidden="true" />
        <span :key="agent.status" class="ccm-glyph-pop inline-flex shrink-0"><StatusIcon :status="agent.status" :size="14" /></span>
        <span class="nodrag max-w-[60%] shrink-0 cursor-text truncate font-semibold select-text">{{ name }}</span>
        <ProviderBadge v-if="codex" :mode="agent.type" variant="icon" />
        <Transition name="ccm-swap" mode="out-in">
          <span :key="detail" class="nodrag min-w-0 flex-1 cursor-text truncate text-ink-muted select-text">{{ detail }}</span>
        </Transition>
        <span v-if="elapsed" class="shrink-0 tabular-nums text-ink-faint">{{ elapsed }}</span>
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
      </div>
    </div>
  </div>
</template>
