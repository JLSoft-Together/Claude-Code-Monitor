<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from 'vue'
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
import CompactView from './components/CompactView.vue'
import MonitorView from './components/MonitorView.vue'
import UsageView from './components/usage/UsageView.vue'
import HistoryView from './components/history/HistoryView.vue'

const { t } = useI18n()
const connection = useConnectionStore()
const ui = useUiStore()
useSettingsStore()
useNotifications()
useBreakReminder()
useAwayStore().install()

const header = ref<ComponentPublicInstance | null>(null)
const headerObserver = new ResizeObserver(([entry]) => {
  if (entry) document.documentElement.style.setProperty('--ccm-header-h', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`)
})

onMounted(() => {
  startClock()
  connection.start()
  const el = header.value?.$el as Element | undefined
  if (el) headerObserver.observe(el)
})
onBeforeUnmount(() => headerObserver.disconnect())
</script>

<template>
  <div class="flex min-h-dvh flex-col overflow-x-hidden">
    <a
      href="#main"
      class="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {{ t('app.skipToContent') }}
    </a>
    <AppHeader ref="header" />
    <Transition name="ccm-view" mode="out-in">
      <CompactView v-if="ui.compact" id="main" key="compact" />
      <MonitorView v-else-if="ui.view === 'monitor'" id="main" key="monitor" />
      <UsageView v-else-if="ui.view === 'usage'" id="main" key="usage" />
      <HistoryView v-else id="main" key="history" />
    </Transition>
    <CommandPalette />
    <RecapDialog />
    <DiagnosticsDialog />
    <OnboardingTour />
    <BreakToast />
  </div>
</template>
