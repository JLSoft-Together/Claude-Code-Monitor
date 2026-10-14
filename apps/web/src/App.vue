<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBreakReminder } from './composables/useBreakReminder'
import { useNotifications } from './composables/useNotifications'
import { startClock } from './lib/format'
import { useAwayStore } from './stores/away'
import { useConnectionStore } from './stores/connection'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'
import AppHeader from './components/AppHeader.vue'
import CommandPalette from './components/CommandPalette.vue'
import RecapDialog from './components/RecapDialog.vue'
import DiagnosticsDialog from './components/DiagnosticsDialog.vue'
import OnboardingTour from './components/OnboardingTour.vue'
import BreakToast from './components/BreakToast.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import CompactView from './components/CompactView.vue'
import MonitorView from './components/MonitorView.vue'
import UsageView from './components/usage/UsageView.vue'
import HistoryView from './components/history/HistoryView.vue'
import { desktop, hasTerminals } from './lib/desktop'
import { useRevealInWorkspace } from './composables/useRevealInWorkspace'
import { isMac } from './lib/platform'

// xterm + addons (~400 KB) load only when the workspace is first opened.
const WorkspaceView = defineAsyncComponent(() => import('./components/workspace/WorkspaceView.vue'))

const { t } = useI18n()
const connection = useConnectionStore()
const ui = useUiStore()
useSettingsStore()
useNotifications()
useBreakReminder()
useAwayStore().install()

// Windows toast buttons reach the app through agent-monitor://; a session running in a pane opens that pane.
const reveal = useRevealInWorkspace()
desktop?.onFocus?.((terminalId) => reveal.show(terminalId))
// Chords pressed while a browser pane's page has focus come back from the main process; replay them on the
// window (not inside .xterm) so the workspace / palette handlers see them as usual.
desktop?.onForwardKey?.((key) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { ...key, bubbles: true, cancelable: true }))
})
desktop?.onSelect?.((terminalId) => {
  ui.setView('monitor')
  ui.focusTerminal(terminalId)
})

const showWorkspace = computed(() => hasTerminals && !ui.compact && ui.view === 'workspace')
const workspaceOpened = ref(false)
watch(showWorkspace, (shown) => shown && (workspaceOpened.value = true), { immediate: true })

// The outgoing view lingers for its fade; it must not keep the #main skip target or take clicks.
function retireView(el: Element): void {
  el.removeAttribute('id')
  el.setAttribute('inert', '')
}

const header = ref<ComponentPublicInstance | null>(null)
const headerObserver = new ResizeObserver(([entry]) => {
  if (entry) document.documentElement.style.setProperty('--ccm-header-h', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`)
})

// The mac menu leaves Cmd+W to the page; the workspace closes a pane with it, every other view closes the window.
function onCloseKey(e: KeyboardEvent): void {
  if (!isMac || !e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.code !== 'KeyW' || showWorkspace.value) return
  e.preventDefault()
  window.close()
}

onMounted(() => {
  startClock()
  window.addEventListener('keydown', onCloseKey)
  connection.start()
  const el = header.value?.$el as Element | undefined
  if (el) headerObserver.observe(el)
})
onBeforeUnmount(() => {
  headerObserver.disconnect()
  window.removeEventListener('keydown', onCloseKey)
})
</script>

<template>
  <div class="flex min-h-dvh flex-col overflow-x-hidden">
    <a
      href="#main"
      class="sr-only z-50 rounded-inner bg-surface px-3 py-2 text-sm shadow-pop focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {{ t('app.skipToContent') }}
    </a>
    <AppHeader ref="header" />
    <!-- Views share one grid cell so the switch is a crossfade in place, never the old view pushing the new one down. -->
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] *:[grid-area:1/1]">
      <Transition name="ccm-view" @before-leave="retireView">
        <CompactView v-if="ui.compact" id="main" key="compact" />
        <MonitorView v-else-if="ui.view === 'monitor'" id="main" key="monitor" />
        <UsageView v-else-if="ui.view === 'usage'" id="main" key="usage" />
        <HistoryView v-else-if="ui.view === 'history'" id="main" key="history" />
      </Transition>
      <!-- Kept mounted once opened: switching views must not tear down the terminals' xterm state. -->
      <Transition name="ccm-view">
        <WorkspaceView v-if="workspaceOpened" v-show="showWorkspace" :id="showWorkspace ? 'main' : undefined" :visible="showWorkspace" />
      </Transition>
    </div>
    <CommandPalette />
    <RecapDialog />
    <DiagnosticsDialog />
    <OnboardingTour />
    <BreakToast />
    <ShortcutsDialog />
  </div>
</template>
