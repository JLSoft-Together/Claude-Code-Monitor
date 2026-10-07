<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { startClock } from './lib/format'
import { useConnectionStore } from './stores/connection'
import { useSettingsStore } from './stores/settings'
import ActivityFeed from './components/ActivityFeed.vue'
import AgentMap from './components/AgentMap.vue'
import AppHeader from './components/AppHeader.vue'
import SessionList from './components/SessionList.vue'

const { t } = useI18n()
const connection = useConnectionStore()
useSettingsStore()

onMounted(() => {
  startClock()
  connection.start()
})
</script>

<template>
  <div class="flex min-h-dvh flex-col overflow-x-hidden lg:h-dvh">
    <a
      href="#sessions"
      class="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {{ t('app.skipToContent') }}
    </a>
    <AppHeader />
    <main
      class="mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-[minmax(0,1fr)] gap-4 px-4 py-4 sm:px-6 lg:min-h-0 lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_260px] xl:grid-cols-[340px_minmax(0,1fr)_320px] xl:grid-rows-1"
      :class="connection.state !== 'connected' && connection.hasData ? 'opacity-90' : ''"
    >
      <div class="min-w-0 lg:row-span-2 lg:min-h-0 lg:overflow-y-auto lg:pr-1 xl:row-span-1">
        <SessionList />
      </div>
      <AgentMap class="min-h-[460px] min-w-0 lg:min-h-0" />
      <ActivityFeed class="max-h-[420px] min-w-0 lg:col-start-2 lg:max-h-none lg:min-h-0 xl:col-start-3" />
    </main>
  </div>
</template>
