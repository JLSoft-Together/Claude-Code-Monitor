<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TerminalSquare } from 'lucide-vue-next'
import { useConnectionStore } from '../stores/connection'
import { useTerminalsStore } from '../stores/terminals'
import SessionCard from './SessionCard.vue'

const { t } = useI18n()
const terminals = useTerminalsStore()
const connection = useConnectionStore()
</script>

<template>
  <section id="sessions" aria-labelledby="sessions-title" class="flex min-h-0 flex-col">
    <div class="mb-2.5 flex items-baseline justify-between px-0.5">
      <h2 id="sessions-title" class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {{ t('sessions.title') }}
      </h2>
      <span class="text-xs text-ink-faint tabular">{{ terminals.live.length }}</span>
    </div>

    <div v-if="!connection.hasData" class="rounded-lg border border-dashed border-line-strong px-4 py-6 text-sm">
      <template v-if="connection.state === 'disconnected'">
        <p class="font-medium text-st-error">{{ t('sessions.offline') }}</p>
        <p class="mt-1 text-xs text-ink-muted">{{ t('sessions.offlineHint') }}</p>
      </template>
      <p v-else class="text-ink-muted">{{ t('sessions.loading') }}</p>
    </div>

    <div
      v-else-if="terminals.list.length === 0"
      class="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong px-4 py-6"
    >
      <TerminalSquare :size="18" class="text-ink-faint" aria-hidden="true" />
      <p class="text-sm font-medium">{{ t('sessions.empty') }}</p>
      <p class="text-xs text-ink-muted">{{ t('sessions.emptyHint') }}</p>
    </div>

    <ul v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
      <li v-for="terminal in terminals.list" :key="terminal.id">
        <SessionCard :terminal="terminal" />
      </li>
    </ul>
  </section>
</template>
