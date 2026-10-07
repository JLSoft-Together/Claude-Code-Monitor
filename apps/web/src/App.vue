<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotifications } from './composables/useNotifications'
import { startClock } from './lib/format'
import { useAwayStore } from './stores/away'
import { useConnectionStore } from './stores/connection'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'
import AppHeader from './components/AppHeader.vue'
import CommandPalette from './components/CommandPalette.vue'
import RecapDialog from './components/RecapDialog.vue'
import MonitorView from './components/MonitorView.vue'
import UsageView from './components/usage/UsageView.vue'
import HistoryView from './components/history/HistoryView.vue'

const { t } = useI18n()
const connection = useConnectionStore()
const ui = useUiStore()
useSettingsStore()
useNotifications()
useAwayStore().install()

onMounted(() => {
  startClock()
  connection.start()
})
</script>

<template>
  <div class="flex min-h-dvh flex-col overflow-x-hidden" :class="ui.view === 'monitor' ? 'lg:h-dvh' : ''">
    <a
      href="#main"
      class="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {{ t('app.skipToContent') }}
    </a>
    <AppHeader />
    <Transition name="ccm-view" mode="out-in">
      <MonitorView v-if="ui.view === 'monitor'" id="main" key="monitor" />
      <UsageView v-else-if="ui.view === 'usage'" id="main" key="usage" />
      <HistoryView v-else id="main" key="history" />
    </Transition>
    <CommandPalette />
    <RecapDialog />
  </div>
</template>
