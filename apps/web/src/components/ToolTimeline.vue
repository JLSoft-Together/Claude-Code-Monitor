<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert, X } from 'lucide-vue-next'
import type { Agent, ToolSpan } from '@ccm/shared'
import { useAgentsStore } from '../stores/agents'
import { useConnectionStore } from '../stores/connection'
import { useTerminalsStore } from '../stores/terminals'
import { useToolSpansStore } from '../stores/toolSpans'
import { useUiStore } from '../stores/ui'
import { clockTime, now } from '../lib/format'
import { displayTitle } from '../lib/title'
import { formatMs, laneLayout, lanesFor, spansInWindow, ticks, toolStats, type Bar } from '../lib/toolTimeline'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ terminalId?: string | null }>()
const { t, locale } = useI18n()
const agents = useAgentsStore()
const terminals = useTerminalsStore()
const toolSpans = useToolSpansStore()
const connection = useConnectionStore()
const ui = useUiStore()

const LABEL_MIN_PX = 48

const fromMs = computed(() => now.value - ui.timelineWindow * 60_000)

function load(): void {
  connection.loadToolSpans(props.terminalId ?? undefined, new Date(fromMs.value).toISOString())
}
onMounted(load)
watch(() => ui.timelineWindow, load)
watch(
  () => connection.state,
  (state, prev) => {
    if (state === 'connected' && prev !== 'connected') load()
  },
)

const spans = computed(() => {
  void toolSpans.version
  return spansInWindow(toolSpans.spansFor(props.terminalId ?? undefined), fromMs.value)
})

function laneName(terminalId: string, agent: Agent | undefined): string {
  if (!agent) return t('tools.endedSubagent')
  if (agent.role === 'main') return displayTitle(terminals.byId[terminalId]) || agent.name || agent.id
  return agent.type ?? agent.name ?? t('agent.subagent')
}

const groups = computed(() => {
  const byTerminal = new Map<string, ToolSpan[]>()
  for (const s of spans.value) {
    const list = byTerminal.get(s.terminalId) ?? []
    list.push(s)
    byTerminal.set(s.terminalId, list)
  }
  const order = [...terminals.list]
    .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.id.localeCompare(b.id))
    .map((x) => x.id)
  for (const id of byTerminal.keys()) if (!order.includes(id)) order.push(id)
  return order
    .filter((id) => byTerminal.has(id))
    .map((id) => {
      const terminal = terminals.byId[id]
      return {
        id,
        title: terminal ? displayTitle(terminal) : id,
        status: terminal?.status ?? 'unknown',
        lanes: lanesFor(byTerminal.get(id)!, agents.byTerminal[id] ?? []).map((lane) => ({
          key: `${id}:${lane.agentId}`,
          name: laneName(id, lane.agent),
          depth: lane.depth,
          bars: laneLayout(lane.spans, fromMs.value, now.value),
        })),
      }
    })
})

const stats = computed(() => toolStats(spans.value, now.value))
const axisTicks = computed(() =>
  ticks(fromMs.value, now.value, ui.timelineWindow).map((ms) => ({ ms, left: ((ms - fromMs.value) / (now.value - fromMs.value)) * 100 })),
)

const hoveredTool = ref<string | null>(null)
const active = ref<Record<string, number>>({})

const axis = ref<HTMLElement | null>(null)
const trackPx = ref(0)
let observer: ResizeObserver | undefined
watch(axis, (el) => {
  observer?.disconnect()
  if (!el || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => (trackPx.value = entry?.contentRect.width ?? 0))
  observer.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())

function outcomeOf(bar: Bar): 'ok' | 'error' | 'interrupted' | 'running' {
  return bar.running ? 'running' : (bar.span.outcome ?? 'ok')
}

const BAR_CLASS = {
  ok: 'inset-y-1 rounded-sm bg-ink-faint/40 text-ink',
  error: 'inset-y-0 rounded-none bg-st-error text-surface',
  interrupted: 'inset-y-1 rounded-sm ccm-stripe text-ink',
  running: 'inset-y-1 rounded-l-sm border-r-2 border-dashed border-ink bg-st-working text-surface ccm-breathe',
}

function barPx(bar: Bar): number {
  return (bar.width / 100) * trackPx.value
}

function barLabel(bar: Bar, laneName: string): string {
  const start = Date.parse(bar.span.start)
  const end = bar.span.end ? Date.parse(bar.span.end) : now.value
  return t('tools.barLabel', {
    tool: bar.span.tool,
    duration: formatMs(Math.max(0, end - start)),
    start: clockTime(bar.span.start, locale.value),
    outcome: t(`tools.outcome.${outcomeOf(bar)}`),
    agent: laneName,
  })
}

function activeIndex(key: string, count: number): number {
  return Math.min(active.value[key] ?? count - 1, count - 1)
}

function move(event: KeyboardEvent, key: string, count: number): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const next = Math.min(count - 1, Math.max(0, activeIndex(key, count) + step))
  active.value = { ...active.value, [key]: next }
  const buttons = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')
  buttons[next]?.focus()
}

function onBarFocus(key: string, index: number, tool: string): void {
  hoveredTool.value = tool
  active.value = { ...active.value, [key]: index }
}

function clock(ms: number): string {
  return new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}
</script>

<template>
  <div class="absolute inset-0 overflow-x-hidden overflow-y-auto p-3 text-xs">
    <p v-if="connection.state === 'reconnecting'" class="mb-2 rounded-inner bg-fill px-2 py-1.5 text-ink-muted" role="status">{{ t('connection.stale') }}</p>

    <div v-if="!groups.length" class="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-ink-muted">
      <p>{{ t('tools.empty', { n: ui.timelineWindow }) }}</p>
      <p class="text-xs text-ink-faint">{{ t('tools.emptyHint') }}</p>
    </div>

    <template v-else>
      <div role="group" :aria-label="t('tools.lanes')">
        <div class="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-2">
          <div />
          <div ref="axis" class="relative h-5 text-ink-faint" aria-hidden="true">
            <span v-for="tick in axisTicks.filter((x) => x.left <= 90)" :key="tick.ms" class="absolute top-0 -translate-x-1/2 tabular-nums" :style="{ left: `${tick.left}%` }">{{ clock(tick.ms) }}</span>
            <span class="absolute top-0 right-0">{{ t('tools.axis') }}</span>
          </div>
        </div>

        <section v-for="group in groups" :key="group.id" class="mb-2">
          <h3 v-if="!terminalId" class="flex min-w-0 items-center gap-1.5 border-t border-line pt-2 pb-1 font-medium text-ink">
            <StatusIcon :status="group.status" :size="13" :animate="false" />
            <span class="truncate" :title="group.title">{{ group.title }}</span>
          </h3>
          <div v-for="lane in group.lanes" :key="lane.key" class="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-x-2 py-0.5">
            <span class="truncate text-ink-muted" :style="{ paddingLeft: `${lane.depth * 12}px` }" :title="lane.name">{{ lane.name }}</span>
            <div class="relative h-6 overflow-hidden rounded-sm bg-fill" role="group" :aria-label="lane.name" @keydown="move($event, lane.key, lane.bars.length)">
              <span v-for="tick in axisTicks" :key="tick.ms" class="absolute inset-y-0 w-px bg-line" :style="{ left: `${tick.left}%` }" aria-hidden="true" />
              <button
                v-for="(bar, i) in lane.bars"
                :key="bar.span.id"
                type="button"
                class="absolute flex cursor-default items-center gap-0.5 px-0.5 text-2xs leading-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-accent"
                :class="[BAR_CLASS[outcomeOf(bar)], hoveredTool === bar.span.tool ? 'z-10 ring-2 ring-accent' : '']"
                :style="{ left: `${bar.left}%`, width: `${bar.width}%`, minWidth: '2px' }"
                :tabindex="i === activeIndex(lane.key, lane.bars.length) ? 0 : -1"
                :title="barLabel(bar, lane.name)"
                :aria-label="barLabel(bar, lane.name)"
                @mouseenter="hoveredTool = bar.span.tool"
                @mouseleave="hoveredTool = null"
                @focus="onBarFocus(lane.key, i, bar.span.tool)"
                @blur="hoveredTool = null"
              >
                <X v-if="outcomeOf(bar) === 'error' && barPx(bar) >= 12" :size="10" class="shrink-0" aria-hidden="true" />
                <span v-if="barPx(bar) >= LABEL_MIN_PX" class="min-w-0 truncate">{{ bar.span.tool }}</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <table class="mt-3 w-full table-fixed text-left tabular-nums" :aria-label="t('tools.stats')">
        <thead class="text-ink-muted">
          <tr class="border-b border-line">
            <th scope="col" class="w-[34%] py-1.5 pr-2 font-medium">{{ t('tools.col.tool') }}</th>
            <th scope="col" class="px-1 py-1.5 text-right font-medium">{{ t('tools.col.calls') }}</th>
            <th scope="col" class="px-1 py-1.5 text-right font-medium">{{ t('tools.col.errors') }}</th>
            <th scope="col" class="px-1 py-1.5 text-right font-medium">{{ t('tools.col.p50') }}</th>
            <th scope="col" class="px-1 py-1.5 text-right font-medium">{{ t('tools.col.p95') }}</th>
            <th scope="col" class="px-1 py-1.5 text-right font-medium">{{ t('tools.col.total') }}</th>
            <th scope="col" class="py-1.5 pl-1 text-right font-medium">{{ t('tools.col.running') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in stats"
            :key="row.tool"
            tabindex="0"
            class="border-b border-line text-ink outline-none focus-visible:bg-fill"
            :class="hoveredTool === row.tool ? 'bg-fill ring-2 ring-accent ring-inset' : ''"
            @mouseenter="hoveredTool = row.tool"
            @mouseleave="hoveredTool = null"
            @focus="hoveredTool = row.tool"
            @blur="hoveredTool = null"
          >
            <td class="py-1.5 pr-2">
              <span class="block truncate" :title="row.tool">{{ row.tool }}</span>
              <span v-if="row.warn" class="mt-0.5 inline-flex items-center gap-1 text-st-error">
                <TriangleAlert :size="12" aria-hidden="true" />{{ t('tools.warn') }}
              </span>
            </td>
            <td class="px-1 py-1.5 text-right">{{ row.calls }}</td>
            <td class="px-1 py-1.5 text-right" :class="row.errors ? 'text-st-error' : 'text-ink-faint'">{{ row.errors }} ({{ percent(row.errorRate) }})</td>
            <td class="px-1 py-1.5 text-right">{{ row.p50 === undefined ? '–' : formatMs(row.p50) }}</td>
            <td class="px-1 py-1.5 text-right">{{ row.p95 === undefined ? '–' : formatMs(row.p95) }}</td>
            <td class="px-1 py-1.5 text-right">{{ formatMs(row.totalMs) }}</td>
            <td class="py-1.5 pl-1 text-right" :class="row.running ? 'text-st-working' : 'text-ink-faint'">{{ row.running }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.ccm-stripe {
  background: repeating-linear-gradient(135deg, var(--color-st-waiting) 0 3px, var(--color-st-waiting-soft) 3px 6px);
}
</style>
