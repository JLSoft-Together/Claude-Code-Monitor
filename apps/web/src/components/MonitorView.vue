<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useShortcuts } from '../composables/useShortcuts'
import { useConnectionStore } from '../stores/connection'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore, type Panel } from '../stores/ui'
import ActivityFeed from './ActivityFeed.vue'
import AwaySummary from './AwaySummary.vue'
import AgentMap from './AgentMap.vue'
import PanelHeader from './PanelHeader.vue'
import PanelSplitter from './PanelSplitter.vue'
import SessionBar from './SessionBar.vue'
import SessionCard from './SessionCard.vue'
import SessionList from './SessionList.vue'
import WaitingQueue from './WaitingQueue.vue'

const { t } = useI18n()
const connection = useConnectionStore()
const terminals = useTerminalsStore()
const ui = useUiStore()
useShortcuts()

const MAP_MIN = 360
const FLOAT_INSET = 8

const stage = ref<HTMLElement | null>(null)
const stageWidth = ref(0)
const dragging = ref(false)
const observer = new ResizeObserver(([entry]) => (stageWidth.value = entry?.contentRect.width ?? 0))
watch(stage, (el, old) => {
  if (old) observer.unobserve(old)
  if (el) observer.observe(el)
})
onBeforeUnmount(() => observer.disconnect())

const tabTerminal = computed(() => (ui.sessionTab ? terminals.byId[ui.sessionTab] : undefined))

const pinnedWidth = (p: Panel) => (ui.panels[p].open && ui.panels[p].pinned ? ui.panelSize[p] : 0)
function widthOf(p: Panel): number {
  const max = ui.panels[p].pinned ? stageWidth.value - MAP_MIN : stageWidth.value - 2 * FLOAT_INSET
  return Math.max(0, Math.min(ui.panelSize[p], max))
}
/** Keeps at least MAP_MIN px of map beside pinned panels; a floating panel only has to fit the stage. */
function maxFor(p: Panel): number {
  const other: Panel = p === 'sessions' ? 'activity' : 'sessions'
  return ui.panels[p].pinned ? Math.max(0, stageWidth.value - pinnedWidth(other) - MAP_MIN) : Math.max(0, stageWidth.value - 2 * FLOAT_INSET)
}

const PANEL_BASE = 'flex min-h-0 flex-col bg-canvas p-3'
const PANEL_FLOAT = 'absolute inset-y-2 z-20 rounded-xl border border-line-strong shadow-xl'
function panelClass(p: Panel): string {
  const { pinned } = ui.panels[p]
  if (p === 'sessions') return `${PANEL_BASE} ${pinned ? 'relative shrink-0 border-r border-line' : `${PANEL_FLOAT} left-2`}`
  return `${PANEL_BASE} ${pinned ? 'relative shrink-0 border-l border-line' : `${PANEL_FLOAT} right-2`}`
}
/** Floating panels slide in from their edge; pinned ones only fade (sliding would resize the map every frame). */
function panelTransition(p: Panel): string {
  if (ui.panels[p].pinned) return 'ccm-fade'
  return p === 'sessions' ? 'ccm-panel-left' : 'ccm-panel-right'
}
</script>

<template>
  <main
    class="flex h-[calc(100dvh-var(--ccm-header-h,4.5rem))] min-h-[420px] w-full flex-col overflow-hidden"
    :class="connection.state !== 'connected' && connection.hasData ? 'opacity-90' : ''"
  >
    <SessionBar v-if="ui.barDock === 'top'" data-tour="metrics" />
    <div class="flex shrink-0 flex-col gap-2 px-3 pt-2 empty:hidden">
      <AwaySummary />
      <WaitingQueue v-if="!ui.sessionTab" data-tour="waiting" class="ccm-scroll max-h-40 overflow-y-auto" />
    </div>

    <div ref="stage" class="relative flex min-h-0 flex-1" :class="dragging ? 'select-none' : ''">
      <Transition :name="panelTransition('sessions')">
        <aside
          v-show="ui.panels.sessions.open"
          data-tour="sessions"
          :class="panelClass('sessions')"
          :style="{ width: `${widthOf('sessions')}px` }"
        >
          <SessionList v-if="!ui.sessionTab" />
          <section v-else-if="tabTerminal" aria-labelledby="session-panel-title" class="flex h-full min-h-0 flex-col">
            <PanelHeader panel="sessions" title-id="session-panel-title" :title="t('panel.session')" />
            <div class="ccm-scroll -mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
              <SessionCard :terminal="tabTerminal" />
            </div>
          </section>
          <PanelSplitter
            v-model:dragging="dragging"
            size="sessions"
            axis="x"
            :sign="1"
            :label="t('sessions.title')"
            :max="maxFor('sessions')"
            class="inset-y-0 -right-2"
          />
        </aside>
      </Transition>

      <AgentMap :key="ui.sessionTab ?? 'all'" :terminal-id="ui.sessionTab" data-tour="map" class="min-w-0 flex-1" />

      <Transition :name="panelTransition('activity')">
        <aside
          v-show="ui.panels.activity.open"
          data-tour="activity"
          :class="panelClass('activity')"
          :style="{ width: `${widthOf('activity')}px` }"
        >
          <ActivityFeed :key="ui.sessionTab ?? 'all'" :terminal-id="ui.sessionTab" />
          <PanelSplitter
            v-model:dragging="dragging"
            size="activity"
            axis="x"
            :sign="-1"
            :label="t('activity.title')"
            :max="maxFor('activity')"
            class="inset-y-0 -left-2"
          />
        </aside>
      </Transition>
    </div>

    <SessionBar v-if="ui.barDock === 'bottom'" data-tour="metrics" />
  </main>
</template>
