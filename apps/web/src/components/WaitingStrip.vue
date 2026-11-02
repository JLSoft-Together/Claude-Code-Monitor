<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Hand } from 'lucide-vue-next'
import { duration, now } from '../lib/format'
import { displayTitle } from '../lib/title'
import { waitingSummary } from '../lib/waitingStrip'
import { useExtrasStore } from '../stores/extras'
import { useSnoozeStore } from '../stores/snooze'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const terminals = useTerminalsStore()
const extras = useExtrasStore()
const snooze = useSnoozeStore()
const ui = useUiStore()

const summary = computed(() =>
  waitingSummary(terminals.live, extras.blockedJobs.length, (id) => snooze.isSnoozed(terminals.byId[id], now.value)),
)
const oldest = computed(() => {
  const o = summary.value.oldest
  const term = o ? terminals.byId[o.id] : undefined
  if (!o || !term) return null
  return t('monitorV79.strip.oldest', { title: displayTitle(term), waited: duration(new Date(o.since).toISOString(), now.value) ?? '' })
})
</script>

<template>
  <button
    v-if="summary.count"
    type="button"
    class="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-control bg-st-waiting-soft px-2.5 text-xs text-st-waiting outline-none transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-focus"
    :aria-label="`${t('monitorV79.strip.label', { n: summary.count })}. ${t('monitorV79.strip.open')}`"
    :title="t('monitorV79.strip.open')"
    data-waiting-strip
    @click="ui.panels.sessions.open = true"
  >
    <Hand :size="14" class="shrink-0" aria-hidden="true" />
    <span class="shrink-0 font-semibold tabular-nums">{{ t('monitorV79.strip.label', { n: summary.count }) }}</span>
    <span v-if="oldest" class="min-w-0 flex-1 truncate text-start text-ink-muted">{{ oldest }}</span>
  </button>
</template>
