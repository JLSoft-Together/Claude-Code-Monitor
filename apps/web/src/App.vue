<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppToasts } from './composables/useAppToasts'
import { useBreakReminder } from './composables/useBreakReminder'
import { useNotifications } from './composables/useNotifications'
import { startClock } from './lib/format'
import { useAwayStore } from './stores/away'
import { useConnectionStore } from './stores/connection'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'
import { useWorkspaceStore } from './stores/workspace'
import { useDeepSeekStore } from './stores/deepseek'
import AppHeader from './components/AppHeader.vue'
import CommandPalette from './components/CommandPalette.vue'
import OnboardingTour from './components/OnboardingTour.vue'
import ToastHost from './components/ToastHost.vue'
import { hasBuildClean } from './lib/buildClean'
import QuickSetup from './components/QuickSetup.vue'
import WhatsNewDialog from './components/WhatsNewDialog.vue'
import { lazyOverlay } from './lib/lazyOverlay'
import { useResourcesStore } from './stores/resources'
import { useUpdateStore } from './stores/update'
import ZoomHud from './components/ZoomHud.vue'
import { useWheelZoom } from './composables/useWheelZoom'
import CompactView from './components/CompactView.vue'
import MonitorView from './components/MonitorView.vue'
import UsageView from './components/usage/UsageView.vue'
import HistoryView from './components/history/HistoryView.vue'
import { desktop, hasDeepSeek, hasExtensions, hasTerminals } from './lib/desktop'
import { hasDevices } from './lib/devices'
import { useRevealInWorkspace } from './composables/useRevealInWorkspace'
import { handleOrrery, installOrreryApi } from './composables/useOrreryApi'
import { useTurnCheckpoints } from './composables/useTurnCheckpoints'
import { isMac } from './lib/platform'
import { restoreMode, restoreWith, startupRun, uncleanExit } from './lib/workspaceRestore'

// xterm + addons (~400 KB) load only when the workspace is first opened.
const WorkspaceView = defineAsyncComponent(() => import('./components/workspace/WorkspaceView.vue'))
const ExtensionsView = defineAsyncComponent(() => import('./components/extensions/ExtensionsView.vue'))
const DevicesView = defineAsyncComponent(() => import('./components/devices/DevicesView.vue'))
const DevToolsDialog = defineAsyncComponent(() => import('./components/DevToolsDialog.vue'))
const BuildCleanDialog = defineAsyncComponent(() => import('./components/BuildCleanDialog.vue'))

const { t } = useI18n()
const connection = useConnectionStore()
const ui = useUiStore()
useSettingsStore()
useTurnCheckpoints()
useNotifications()
useBreakReminder()
useAppToasts()
useWheelZoom()
useAwayStore().install()
const update = useUpdateStore()
update.start()
const resources = useResourcesStore()

// Opened only by a menu / shortcut / palette entry; QuickSetup, OnboardingTour and WhatsNewDialog stay eager because they open themselves at launch, CommandPalette because it owns Ctrl+K.
const recap = lazyOverlay(() => import('./components/RecapDialog.vue'), () => ui.recapOpen)
const diagnostics = lazyOverlay(() => import('./components/DiagnosticsDialog.vue'), () => ui.diagnosticsOpen)
const resourcesDialog = lazyOverlay(() => import('./components/ResourcesDialog.vue'), () => resources.open)
const shortcuts = lazyOverlay(() => import('./components/ShortcutsDialog.vue'), () => ui.shortcutsOpen)
const updateDialog = lazyOverlay(() => import('./components/UpdateDialog.vue'), () => update.dialogOpen)

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

const workspace = useWorkspaceStore()
const deepseek = useDeepSeekStore()
// Warm the launch gate's cache in the background (three short codewhale runs, only when it is installed).
if (hasDeepSeek && !ui.compact) window.setTimeout(() => void deepseek.refresh().catch(() => null), 4_000)
installOrreryApi()
handleOrrery('session.open', async (req, caller) => {
  const setupBlocked = hasDeepSeek && req.preset === 'deepseek' && (await deepseek.gateAgent())
  // Only open_session has a host ticket behind its id; a link's id is just a request id, so its pane mints its own session id.
  const result = workspace.openSession(caller.source === 'mcp' ? req : { ...req, id: undefined }, { source: caller.source, setupBlocked })
  if (!result.ok) return result
  if (caller.source === 'mcp') workspaceOpened.value = true
  else ui.setView('workspace')
  return result
})

// Only the first window of an app start: reopen the last workspace in the background, or flag a crash for the picker.
if (hasTerminals && !ui.compact)
  void startupRun().then(async ({ first, unclean }) => {
    if (!first) return
    if (restoreMode.value === 'auto' && workspace.last && !workspace.panes.length) {
      await restoreWith(workspace.lastMovedDirs, undefined, (run, gone) => workspace.restoreLast(run, gone))
      workspaceOpened.value = true
    } else uncleanExit.value = unclean
  })

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
        <ExtensionsView v-else-if="ui.view === 'extensions' && hasExtensions" id="main" key="extensions" />
        <DevicesView v-else-if="ui.view === 'devices' && hasDevices" id="main" key="devices" />
      </Transition>
      <!-- Kept mounted once opened: switching views must not tear down the terminals' xterm state. -->
      <Transition name="ccm-view">
        <WorkspaceView v-if="workspaceOpened" v-show="showWorkspace" :id="showWorkspace ? 'main' : undefined" :visible="showWorkspace" />
      </Transition>
    </div>
    <CommandPalette />
    <component :is="recap.Comp" v-if="recap.mounted.value" />
    <DevToolsDialog v-if="ui.devTools" :tool="ui.devTools" @close="ui.devTools = null" />
    <component :is="diagnostics.Comp" v-if="diagnostics.mounted.value" />
    <component :is="resourcesDialog.Comp" v-if="resourcesDialog.mounted.value" />
    <BuildCleanDialog v-if="ui.buildClean && hasBuildClean" :dir="ui.buildClean.dir" @close="ui.buildClean = null" />
    <QuickSetup />
    <OnboardingTour />
    <WhatsNewDialog />
    <component :is="updateDialog.Comp" v-if="updateDialog.mounted.value" />
    <ToastHost />
    <component :is="shortcuts.Comp" v-if="shortcuts.mounted.value" />
    <ZoomHud />
  </div>
</template>
