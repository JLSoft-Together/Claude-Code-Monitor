<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useShortcuts } from '../composables/useShortcuts'
import { useConnectionStore } from '../stores/connection'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore, type Panel } from '../stores/ui'
import AwaySummary from './AwaySummary.vue'
import AgentMap from './AgentMap.vue'
import PanelHeader from './PanelHeader.vue'
import PanelSplitter from './PanelSplitter.vue'
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

function widthOf(p: Panel): number {
  const max = ui.panels[p].pinned ? stageWidth.value - MAP_MIN : stageWidth.value - 2 * FLOAT_INSET
  return Math.max(0, Math.min(ui.panelSize[p], max))
}
/** Keeps at least MAP_MIN px of map beside a pinned panel; a floating panel only has to fit the stage. */
function maxFor(p: Panel): number {
  return ui.panels[p].pinned ? Math.max(0, stageWidth.value - MAP_MIN) : Math.max(0, stageWidth.value - 2 * FLOAT_INSET)
}

const PANEL_BASE = 'flex min-h-0 flex-col bg-canvas p-3'
const PANEL_FLOAT = 'absolute inset-y-2 z-20 rounded-card shadow-pop'
const SHEET = 'absolute inset-x-0 bottom-0 z-30 h-[min(70%,560px)] rounded-t-card border-t border-line shadow-pop'
const sheet = computed(() => ui.narrow)
function panelClass(p: Panel): string {
  if (sheet.value) return `${PANEL_BASE} ${SHEET} pt-1`
  const { pinned } = ui.panels[p]
  if (p === 'sessions') return `${PANEL_BASE} ${pinned ? 'relative shrink-0 border-r border-line' : `${PANEL_FLOAT} left-2`}`
  return `${PANEL_BASE} ${pinned ? 'relative shrink-0 border-l border-line' : `${PANEL_FLOAT} right-2`}`
}
/** Floating panels slide in from their edge; pinned ones only fade (sliding would resize the map every frame). */
function panelTransition(p: Panel): string {
  if (sheet.value) return 'ccm-sheet-up'
  if (ui.panels[p].pinned) return 'ccm-fade'
  return p === 'sessions' ? 'ccm-panel-left' : 'ccm-panel-right'
}
</script>

<template>
  <main
    class="flex h-[calc(100dvh-var(--ccm-header-h,4.5rem))] min-h-[420px] w-full flex-col overflow-hidden transition-opacity duration-(--ccm-dur-slow) ease-out-quint"
    :class="connection.state !== 'connected' && connection.hasData ? 'opacity-90' : ''"
  >
    <div class="flex shrink-0 flex-col gap-2 px-3 pt-2 empty:hidden">
      <AwaySummary />
      <WaitingQueue v-if="!ui.sessionTab" data-tour="waiting" class="ccm-scroll max-h-40 overflow-y-auto" />
    </div>

    <div ref="stage" class="relative flex min-h-0 flex-1" :class="dragging ? 'select-none' : ''">
      <Transition name="ccm-fade">
        <div
          v-if="sheet && ui.panels.sessions.open"
          class="ccm-scrim absolute inset-0 z-30"
          aria-hidden="true"
          data-sheet-scrim
          @mousedown="ui.panels.sessions.open = false"
        />
      </Transition>
      <Transition :name="panelTransition('sessions')">
        <aside
          v-show="ui.panels.sessions.open"
          data-tour="sessions"
          :data-sheet="sheet || undefined"
          :class="panelClass('sessions')"
          :style="sheet ? undefined : { width: `${widthOf('sessions')}px` }"
        >
          <button
            v-if="sheet"
            type="button"
            class="mx-auto mb-1 flex h-4 w-16 shrink-0 cursor-pointer items-center justify-center"
            :aria-label="t('panel.closeSheet')"
            :title="t('panel.closeSheet')"
            @click="ui.panels.sessions.open = false"
          >
            <span class="h-1 w-9 rounded-full bg-fill-strong" aria-hidden="true" />
          </button>
          <SessionList v-if="!ui.sessionTab" />
          <section v-else-if="tabTerminal" aria-labelledby="session-panel-title" class="flex h-full min-h-0 flex-col">
            <PanelHeader panel="sessions" title-id="session-panel-title" :title="t('panel.session')" />
            <div class="ccm-scroll -m-1 min-h-0 flex-1 overflow-y-auto p-1">
              <SessionCard :terminal="tabTerminal" />
            </div>
          </section>
          <PanelSplitter
            v-if="!sheet"
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

    </div>

  </main>
</template>
