<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Layers, Loader2, Square, Trash2, X } from 'lucide-vue-next'
import type { JobState } from '@ccm/shared'
import { compactNumber, duration, now, relativeTime } from '../lib/format'
import { useActivityStore } from '../stores/activity'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import StatusIcon from './StatusIcon.vue'

const { t, locale } = useI18n()
const extras = useExtrasStore()
const terminals = useTerminalsStore()
const connection = useConnectionStore()
const activity = useActivityStore()
const ui = useUiStore()

const ICON: Record<JobState, string> = { working: 'working', blocked: 'waiting', done: 'completed', unknown: 'unknown' }
const STOP_TIMEOUT_MS = 25_000

const confirming = ref<string | null>(null)
const stopping = ref<Record<string, number>>({})

const terminalBySession = computed(() => {
  const map = new Map<string, string>()
  for (const term of terminals.list) if (term.claudeSessionId) map.set(term.claudeSessionId, term.id)
  return map
})

const rows = computed(() =>
  [...extras.jobs]
    .sort((a, b) => Number(a.state === 'done') - Number(b.state === 'done') || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .map((j) => {
      const since = j.stateSince ?? j.updatedAt
      const time = j.state === 'done' ? relativeTime(j.updatedAt, locale.value, now.value) : duration(since, now.value)
      const extra = [
        j.tasks ? t('jobs.tasks', { n: j.tasks }) : null,
        j.queued ? t('jobs.queued', { n: j.queued }) : null,
        j.tokens ? t('jobs.tokens', { n: compactNumber(j.tokens) }) : null,
      ].filter(Boolean)
      const terminalId = j.sessionId ? terminalBySession.value.get(j.sessionId) : undefined
      return { ...j, title: j.name ?? j.id, icon: ICON[j.state], status: t(`jobs.state.${j.state}`), time, extra: extra.join(' · '), terminalId }
    }),
)

const doneCount = computed(() => extras.jobs.filter((j) => j.state === 'done').length)

function clearStopping(id: string): void {
  const timer = stopping.value[id]
  if (timer === undefined) return
  window.clearTimeout(timer)
  const next = { ...stopping.value }
  delete next[id]
  stopping.value = next
}

function confirmStop(id: string): void {
  confirming.value = null
  if (!connection.stopJob(id)) return
  clearStopping(id)
  stopping.value = { ...stopping.value, [id]: window.setTimeout(() => clearStopping(id), STOP_TIMEOUT_MS) }
}

watch(
  () => activity.items,
  (items) => {
    for (const e of items.slice(0, 20)) {
      const id = e.data?.jobId
      if (id && (e.kind === 'job.stopped' || e.kind === 'job.stopFailed')) clearStopping(id)
    }
  },
)

watch(
  () => extras.jobs,
  (jobs) => {
    for (const id of Object.keys(stopping.value)) if (!jobs.some((j) => j.id === id && j.state !== 'done')) clearStopping(id)
    if (confirming.value && !jobs.some((j) => j.id === confirming.value && j.state !== 'done')) confirming.value = null
  },
)

onBeforeUnmount(() => {
  for (const timer of Object.values(stopping.value)) window.clearTimeout(timer)
})
</script>

<template>
  <section v-if="rows.length" class="mb-4" aria-labelledby="jobs-title">
    <div class="mb-2 flex items-center gap-2 px-0.5">
      <h3 id="jobs-title" class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <Layers :size="13" aria-hidden="true" />{{ t('jobs.title') }}
        <span class="truncate font-normal text-ink-faint">{{ t('jobs.hint') }}</span>
      </h3>
      <button
        v-if="doneCount > 0"
        type="button"
        class="ms-auto inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-raised hover:text-st-error"
        @click="connection.dismissJobs()"
      >
        <Trash2 :size="13" aria-hidden="true" />{{ t('jobs.clearDone', { n: doneCount }) }}
      </button>
    </div>
    <TransitionGroup tag="ul" name="ccm-list" class="relative space-y-1.5">
      <li
        v-for="j in rows"
        :key="j.id"
        class="flex items-center gap-1 rounded-xl border bg-surface pe-1.5 transition-[border-color,opacity] duration-300"
        :class="[j.state === 'blocked' ? 'border-st-waiting/50' : 'border-line', j.state === 'done' ? 'opacity-70 hover:opacity-100' : '']"
      >
        <component
          :is="j.terminalId ? 'button' : 'div'"
          :type="j.terminalId ? 'button' : undefined"
          class="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-start"
          :class="j.terminalId ? 'cursor-pointer transition-colors hover:bg-raised' : ''"
          :aria-label="j.terminalId ? t('jobs.focus', { title: j.title }) : undefined"
          :title="j.terminalId ? t('jobs.focus', { title: j.title }) : undefined"
          @click="j.terminalId && ui.focusTerminal(j.terminalId)"
        >
          <span :key="j.state" class="inline-flex shrink-0" :class="j.state === 'blocked' ? 'ccm-pulse' : 'ccm-pop'">
            <StatusIcon :status="j.icon" :size="14" :animate="j.state === 'working'" />
          </span>
          <span class="block min-w-0 flex-1">
            <span class="block truncate text-sm font-medium" :title="j.title">{{ j.title }}</span>
            <span class="block truncate text-2xs text-ink-faint">
              <span :class="j.state === 'blocked' ? 'font-medium text-st-waiting' : ''">{{ j.status }}</span
              ><template v-if="j.time"> · {{ j.time }}</template><template v-if="j.extra"> · {{ j.extra }}</template>
            </span>
          </span>
        </component>
        <span v-if="stopping[j.id] !== undefined" class="inline-flex h-8 shrink-0 items-center gap-1.5 px-2 text-2xs text-ink-muted" role="status">
          <Loader2 :size="13" class="animate-spin" aria-hidden="true" />{{ t('jobs.stopping') }}
        </span>
        <span v-else-if="confirming === j.id" class="ccm-enter inline-flex shrink-0 items-center gap-1 text-2xs" role="group" :aria-label="t('jobs.stop', { title: j.title })">
          <span class="px-1 font-medium text-st-error">{{ t('jobs.stopConfirm') }}</span>
          <button
            type="button"
            class="inline-flex h-7 cursor-pointer items-center rounded-md bg-st-error/15 px-2 font-medium text-st-error transition-colors hover:bg-st-error/25"
            @click="confirmStop(j.id)"
          >
            {{ t('jobs.stopYes') }}
          </button>
          <button
            type="button"
            class="inline-flex h-7 cursor-pointer items-center rounded-md px-2 font-medium text-ink-muted transition-colors hover:bg-raised"
            @click="confirming = null"
          >
            {{ t('jobs.stopNo') }}
          </button>
        </span>
        <button
          v-else-if="j.state !== 'done'"
          type="button"
          class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-st-error"
          :aria-label="t('jobs.stop', { title: j.title })"
          :title="t('jobs.stop', { title: j.title })"
          @click="confirming = j.id"
        >
          <Square :size="13" aria-hidden="true" />
        </button>
        <button
          v-if="stopping[j.id] === undefined && confirming !== j.id"
          type="button"
          class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
          :aria-label="t('jobs.dismiss', { title: j.title })"
          :title="t('jobs.dismiss', { title: j.title })"
          @click="connection.dismissJobs(j.id)"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </li>
    </TransitionGroup>
  </section>
</template>
