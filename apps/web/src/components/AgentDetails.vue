<script setup lang="ts">
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { compactNumber, fullNumber, now, relativeTime } from '../lib/format'
import { codexMode, isCodex } from '../lib/provider'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import KeyHint from './KeyHint.vue'
import ProviderBadge from './ProviderBadge.vue'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{ flowId: string }>()
const { t, locale } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()

const agent = computed(() => (ui.selectedAgentId ? agents.byId[ui.selectedAgentId] : undefined))
const terminal = computed(() => (agent.value ? terminals.byId[agent.value.terminalId] : undefined))
const terminalTitle = computed(() => displayTitle(terminal.value))
const codex = computed(() => isCodex(agent.value))
const heading = computed(() => {
  const a = agent.value
  if (!a) return ''
  if (a.role === 'main') return terminalTitle.value
  return codex.value ? (a.name ?? t('agent.codexRun')) : (a.type ?? a.name ?? '')
})
const eyebrow = computed(() => (agent.value?.role === 'main' ? t('agent.main') : codex.value ? t('agent.codexRun') : t('agent.subagent')))

const rows = computed(() => {
  const a = agent.value
  if (!a) return []
  const out: { label: string; value: string; title?: string; mono?: boolean }[] = []
  out.push({ label: t('agent.session'), value: terminalTitle.value || '—' })
  if (codex.value) {
    const mode = codexMode(a.role === 'main' ? (terminal.value?.entrypoint ?? a.type) : a.type)
    out.push({ label: t('agent.type'), value: mode ? `${t('provider.codex')} · ${t(`provider.mode.${mode}`)}` : t('provider.codex') })
    if (terminal.value?.codexVersion) out.push({ label: t('agent.version'), value: terminal.value.codexVersion, mono: true })
  } else if (a.role === 'subagent') {
    out.push({ label: t('agent.type'), value: a.type ?? '—', mono: true })
    if (a.description) out.push({ label: t('agent.currentTask'), value: a.description })
  }
  out.push({ label: t('agent.currentTool'), value: a.currentTool ?? t('agent.none'), mono: true })
  if (a.model) out.push({ label: t('agent.model'), value: a.model, mono: true })
  const started = relativeTime(a.startedAt, locale.value, now.value)
  if (started) out.push({ label: t('agent.started'), value: started, title: a.startedAt })
  const done = relativeTime(a.completedAt, locale.value, now.value)
  if (done) out.push({ label: t('agent.completed'), value: done, title: a.completedAt })
  if (a.totalTokens !== undefined) {
    out.push({
      label: t('agent.tokens'),
      value: compactNumber(a.totalTokens, locale.value),
      title: t('terminal.tokensTitle', {
        input: fullNumber(a.inputTokens, locale.value),
        output: fullNumber(a.outputTokens, locale.value),
        cache: fullNumber(a.cacheReadTokens, locale.value),
      }),
      mono: true,
    })
  }
  return out
})

const { findNode, viewport, dimensions } = useVueFlow(props.flowId)
const WIDTH = 300
const GAP = 12
const EDGE = 8

/** Next to the node (right, else left); docked top-right when the node is off screen or there is no room. */
const place = computed(() => {
  const a = agent.value
  const node = a ? findNode(a.id) : undefined
  const box = dimensions.value
  if (!a || !box.width) return null
  const docked = { side: null, arrow: 0, style: { top: `${EDGE + 48}px`, right: `${EDGE + 4}px`, width: `${Math.min(WIDTH, box.width - 2 * EDGE)}px`, maxHeight: `${Math.round(box.height * 0.7)}px` } }
  if (!node) return docked
  const { x, y, zoom } = viewport.value
  const left = node.computedPosition.x * zoom + x
  const top = node.computedPosition.y * zoom + y
  const w = node.dimensions.width * zoom
  const h = node.dimensions.height * zoom
  if (left + w < 0 || left > box.width || top + h < 0 || top > box.height) return docked
  const right = left + w + GAP + WIDTH <= box.width - EDGE
  const px = right ? left + w + GAP : left - GAP - WIDTH
  if (px < EDGE) return docked
  const py = Math.max(EDGE, Math.min(top, box.height - 200))
  return {
    side: right ? 'left' : 'right',
    style: { left: `${px}px`, top: `${py}px`, width: `${WIDTH}px`, maxHeight: `${box.height - py - EDGE}px` },
    arrow: Math.max(12, Math.min(top + Math.min(h / 2, 28) - py, 120)),
  }
})

// Grows out of the arrow, so the popover reads as coming from its node.
const origin = computed(() => {
  const p = place.value
  if (!p?.side) return 'top right'
  return `${p.side === 'left' ? '0' : '100%'} ${p.arrow + 5}px`
})
</script>

<template>
  <Transition
    enter-active-class="transition-[opacity,scale] duration-(--ccm-dur-base) ease-out-quint"
    enter-from-class="opacity-0 scale-[0.96]"
    leave-active-class="transition-[opacity,scale] duration-(--ccm-dur-fast) ease-exit"
    leave-to-class="opacity-0 scale-[0.97]"
  >
    <aside
      v-if="agent"
      class="absolute z-10 cursor-auto select-text rounded-card border border-focus bg-surface shadow-pop"
      data-agent-details
      :class="place ? '' : 'top-3 right-3 w-[300px] max-w-[calc(100%-24px)]'"
      :style="[place?.style, { transformOrigin: origin }]"
      :aria-label="eyebrow"
    >
      <span
        v-if="place?.side"
        aria-hidden="true"
        class="absolute size-2.5 rotate-45 border-focus bg-surface"
        :class="place.side === 'left' ? '-left-[6px] border-b border-l' : '-right-[6px] border-t border-r'"
        :style="{ top: `${place.arrow}px` }"
      />
      <div class="ccm-scroll max-h-[inherit] overflow-y-auto p-4">
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-2xs font-medium text-ink-faint">{{ eyebrow }}</p>
          <h3 class="truncate text-base font-semibold" :title="heading">{{ heading }}</h3>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge :status="agent.status" />
            <ProviderBadge v-if="codex" variant="short" :mode="agent.type" />
          </div>
        </div>
        <button
          type="button"
          class="ccm-btn-plain shrink-0"
          :aria-label="t('agent.close')"
          aria-keyshortcuts="Escape"
          @click="ui.selectAgent(null)"
        >
          <X :size="15" aria-hidden="true" /><KeyHint keys="Esc" />
        </button>
      </div>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <template v-for="row in rows" :key="row.label">
          <dt class="text-ink-faint">{{ row.label }}</dt>
          <dd class="min-w-0 break-words" :class="row.mono ? 'font-mono text-2xs leading-5' : ''" :title="row.title">
            {{ row.value }}
          </dd>
        </template>
      </dl>
      </div>
    </aside>
  </Transition>
</template>
