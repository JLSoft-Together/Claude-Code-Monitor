<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Layers } from 'lucide-vue-next'
import type { JobState } from '@ccm/shared'
import { compactNumber, duration, now, relativeTime } from '../lib/format'
import { useExtrasStore } from '../stores/extras'
import StatusIcon from './StatusIcon.vue'

const { t, locale } = useI18n()
const extras = useExtrasStore()

const ICON: Record<JobState, string> = { working: 'working', blocked: 'waiting', done: 'completed', unknown: 'unknown' }

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
      return { ...j, title: j.name ?? j.id, icon: ICON[j.state], status: t(`jobs.state.${j.state}`), time, extra: extra.join(' · ') }
    }),
)
</script>

<template>
  <section v-if="rows.length" class="mb-4" aria-labelledby="jobs-title">
    <h3 id="jobs-title" class="mb-2 flex items-center gap-1.5 px-0.5 text-xs font-semibold text-ink-muted">
      <Layers :size="13" aria-hidden="true" />{{ t('jobs.title') }}
      <span class="font-normal text-ink-faint">{{ t('jobs.hint') }}</span>
    </h3>
    <TransitionGroup tag="ul" name="ccm-list" class="relative space-y-1.5">
      <li
        v-for="j in rows"
        :key="j.id"
        class="flex items-center gap-2.5 rounded-xl border bg-surface px-3 py-2 transition-[border-color,opacity] duration-300"
        :class="[j.state === 'blocked' ? 'border-st-waiting/50' : 'border-line', j.state === 'done' ? 'opacity-70' : '']"
      >
        <span :key="j.state" class="inline-flex shrink-0" :class="j.state === 'blocked' ? 'ccm-pulse' : 'ccm-pop'">
          <StatusIcon :status="j.icon" :size="14" :animate="j.state === 'working'" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" :title="j.title">{{ j.title }}</p>
          <p class="truncate text-2xs text-ink-faint">
            <span :class="j.state === 'blocked' ? 'font-medium text-st-waiting' : ''">{{ j.status }}</span
            ><template v-if="j.time"> · {{ j.time }}</template><template v-if="j.extra"> · {{ j.extra }}</template>
          </p>
        </div>
      </li>
    </TransitionGroup>
  </section>
</template>
