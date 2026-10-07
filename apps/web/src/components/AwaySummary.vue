<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCheck, Coffee, Hand, Repeat, X } from 'lucide-vue-next'
import { duration, now } from '../lib/format'
import { displayTitle } from '../lib/title'
import { useAwayStore } from '../stores/away'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const away = useAwayStore()
const terminals = useTerminalsStore()
const ui = useUiStore()

const s = computed(() => away.summary)
const awayFor = computed(() => (s.value ? (duration(new Date(s.value.since).toISOString(), s.value.until) ?? '') : ''))

const sessionsOf = (ids: string[]) =>
  ids
    .map((id) => terminals.byId[id])
    .filter((x) => x !== undefined)
    .map((x) => ({ id: x.id, title: displayTitle(x), waited: x.status === 'waiting' && x.statusSince ? duration(x.statusSince, now.value) : null }))

const groups = computed(() => {
  const v = s.value
  if (!v) return []
  return [
    { key: 'waiting', icon: Hand, cls: 'text-st-waiting', label: t('away.waiting', { n: v.waiting.length }), items: sessionsOf(v.waiting) },
    { key: 'done', icon: CheckCheck, cls: 'text-st-done', label: t('away.done', { n: v.done.length }), items: sessionsOf(v.done) },
    { key: 'loops', icon: Repeat, cls: 'text-st-error', label: t('away.loops', { n: v.loops.length }), items: sessionsOf(v.loops) },
  ].filter((g) => g.items.length)
})

const facts = computed(() => {
  const v = s.value
  if (!v) return []
  return [
    v.started && t('away.started', { n: v.started }),
    v.ended && t('away.ended', { n: v.ended }),
    v.completedAgents && t('away.agentsDone', { n: v.completedAgents }),
    v.failedAgents && t('away.agentsFailed', { n: v.failedAgents }),
    v.compactions && t('away.compactions', { n: v.compactions }),
    v.jobsDone && t('away.jobsDone', { n: v.jobsDone }),
    v.limitDelta && t('away.limit', { n: v.limitDelta }),
  ].filter((x): x is string => typeof x === 'string')
})

function open(id: string): void {
  ui.focusTerminal(id)
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out-quint motion-reduce:transition-none"
    enter-from-class="opacity-0 -translate-y-2"
    leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
    leave-to-class="opacity-0"
  >
    <section
      v-if="s"
      aria-labelledby="away-title"
      class="relative rounded-xl border border-line bg-surface px-3 py-2.5 pr-11 sm:px-4"
    >
      <span class="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden="true" />
      <h2 id="away-title" class="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
        <Coffee :size="16" class="text-accent" aria-hidden="true" />{{ t('away.title') }}
        <span class="text-xs font-normal text-ink-muted tabular">{{ t('away.duration', { d: awayFor }) }}</span>
      </h2>
      <div v-if="groups.length" class="mt-2 flex flex-col gap-1.5">
        <div v-for="g in groups" :key="g.key" class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium" :class="g.cls">
            <component :is="g.icon" :size="14" aria-hidden="true" />{{ g.label }}
          </span>
          <ul class="flex min-w-0 flex-wrap gap-1.5">
            <li v-for="x in g.items" :key="x.id" class="min-w-0">
              <button
                type="button"
                class="inline-flex h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 text-xs transition-colors hover:border-line-strong"
                :aria-label="t('terminal.focus', { title: x.title })"
                @click="open(x.id)"
              >
                <span class="min-w-0 truncate font-medium">{{ x.title }}</span>
                <span v-if="x.waited" class="shrink-0 text-st-waiting tabular">{{ x.waited }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
      <p v-if="facts.length" class="mt-2 text-xs text-ink-muted">{{ facts.join(' · ') }}</p>
      <button
        type="button"
        class="absolute top-1.5 right-1.5 inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
        :aria-label="t('away.dismiss')"
        :title="t('away.dismiss')"
        @click="away.dismiss()"
      >
        <X :size="16" aria-hidden="true" />
      </button>
    </section>
  </Transition>
</template>
