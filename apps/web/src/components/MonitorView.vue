<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '../stores/connection'
import { useUiStore } from '../stores/ui'
import ActivityFeed from './ActivityFeed.vue'
import AwaySummary from './AwaySummary.vue'
import AgentMap from './AgentMap.vue'
import MetricsStrip from './MetricsStrip.vue'
import PanelSplitter from './PanelSplitter.vue'
import WaitingQueue from './WaitingQueue.vue'
import SessionList from './SessionList.vue'

const { t } = useI18n()
const connection = useConnectionStore()
const ui = useUiStore()

const RAIL = 48
const GAP = 16
const MAP_MIN = 360

const sessionsOpen = computed(() => !ui.isCollapsed('sessions'))
const activityOpen = computed(() => !ui.isCollapsed('activity'))

type Breakpoint = 'sm' | 'lg' | 'xl'
const bp = ref<Breakpoint>('sm')
const grid = ref<HTMLElement | null>(null)
const gridWidth = ref(0)
const dragging = ref(false)

// Tailwind v4 defaults: lg = 64rem, xl = 80rem.
const lgQuery = window.matchMedia('(min-width: 64rem)')
const xlQuery = window.matchMedia('(min-width: 80rem)')
const readBp = () => (bp.value = xlQuery.matches ? 'xl' : lgQuery.matches ? 'lg' : 'sm')
const observer = new ResizeObserver(([entry]) => (gridWidth.value = entry?.contentRect.width ?? 0))

onMounted(() => {
  readBp()
  lgQuery.addEventListener('change', readBp)
  xlQuery.addEventListener('change', readBp)
  if (grid.value) observer.observe(grid.value)
})
onBeforeUnmount(() => {
  lgQuery.removeEventListener('change', readBp)
  xlQuery.removeEventListener('change', readBp)
  observer.disconnect()
})

const sessionsW = computed(() => (sessionsOpen.value ? ui.panelSize.sessions : RAIL))
const activityW = computed(() => (activityOpen.value ? ui.panelSize.activity : RAIL))
const activityH = computed(() => ui.panelSize.activityHeight)

/** Keeps at least MAP_MIN px for the Agent Map between the side panels. */
const maxFor = (other: number) => Math.max(0, gridWidth.value - other - (bp.value === 'xl' ? 2 : 1) * GAP - MAP_MIN)

const gridStyle = computed(() => {
  if (bp.value === 'sm') return {}
  const s = `${sessionsW.value}px`
  if (bp.value === 'xl') return { gridTemplateColumns: `${s} minmax(0,1fr) ${activityW.value}px` }
  return {
    gridTemplateColumns: `${s} minmax(0,1fr)`,
    gridTemplateRows: activityOpen.value ? `minmax(0,1fr) ${activityH.value}px` : 'minmax(0,1fr) auto',
  }
})
</script>

<template>
  <main
    class="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:min-h-0"
    :class="connection.state !== 'connected' && connection.hasData ? 'opacity-90' : ''"
  >
    <AwaySummary />
    <WaitingQueue />
    <MetricsStrip />
    <div
      ref="grid"
      class="relative grid flex-1 grid-cols-[minmax(0,1fr)] gap-4 lg:min-h-0 xl:grid-rows-1"
      :class="dragging ? 'select-none' : 'transition-[grid-template-columns,grid-template-rows] duration-200 ease-out motion-reduce:transition-none'"
      :style="gridStyle"
    >
      <div class="min-w-0 lg:row-span-2 lg:min-h-0 xl:row-span-1" :class="sessionsOpen ? 'lg:overflow-y-auto lg:pr-1' : ''">
        <SessionList />
      </div>
      <AgentMap class="min-h-[480px] min-w-0 lg:min-h-0" />
      <ActivityFeed class="min-w-0 lg:col-start-2 lg:max-h-none lg:min-h-0 xl:col-start-3" :class="activityOpen ? 'max-h-[440px]' : ''" />

      <template v-if="bp !== 'sm'">
        <PanelSplitter
          v-if="sessionsOpen"
          v-model:dragging="dragging"
          size="sessions"
          axis="x"
          :sign="1"
          :label="t('sessions.title')"
          :max="maxFor(bp === 'xl' ? activityW : 0)"
          class="inset-y-0"
          :style="{ left: `${sessionsW + GAP / 2 - 8}px` }"
        />
        <PanelSplitter
          v-if="activityOpen && bp === 'xl'"
          v-model:dragging="dragging"
          size="activity"
          axis="x"
          :sign="-1"
          :label="t('activity.title')"
          :max="maxFor(sessionsW)"
          class="inset-y-0"
          :style="{ right: `${activityW + GAP / 2 - 8}px` }"
        />
        <PanelSplitter
          v-if="activityOpen && bp === 'lg'"
          v-model:dragging="dragging"
          size="activityHeight"
          axis="y"
          :sign="-1"
          :label="t('activity.title')"
          class="right-0"
          :style="{ left: `${sessionsW + GAP}px`, bottom: `${activityH + GAP / 2 - 8}px` }"
        />
      </template>
    </div>
  </main>
</template>
