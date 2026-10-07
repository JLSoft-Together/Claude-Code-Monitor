<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileDown, Search } from 'lucide-vue-next'
import { compactNumber, duration, formatCost, relativeTime, shortPath, now } from '../../lib/format'
import { modelLabel } from '../../lib/model'
import { useConnectionStore } from '../../stores/connection'
import { useExtrasStore } from '../../stores/extras'
import { useHistoryStore } from '../../stores/history'
import { useUiStore } from '../../stores/ui'
import Pager from '../Pager.vue'
import TimelineChart from './TimelineChart.vue'

const { t, locale } = useI18n()
const history = useHistoryStore()
const connection = useConnectionStore()
const extras = useExtrasStore()
const ui = useUiStore()

const PAGE_SIZE = 20
let timer: number | undefined

function refresh(): void {
  connection.loadTimeline()
  connection.loadHistory()
}

onMounted(() => {
  refresh()
  // Open segments grow with the clock locally; the poll only picks up new lanes and closed segments.
  timer = window.setInterval(() => connection.loadTimeline(), 30_000)
})
onBeforeUnmount(() => window.clearInterval(timer))
watch(
  () => connection.state,
  (s) => s === 'connected' && refresh(),
)

const query = ref('')
const page = ref(0)
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }))

const filtered = computed(() => {
  const tokens = fold(query.value).split(/\s+/).filter(Boolean)
  if (!tokens.length) return history.sessions
  return history.sessions.filter((r) => {
    const hay = fold(`${r.title} ${r.cwd ?? ''} ${r.gitBranch ?? ''} ${r.model ?? ''}`)
    return tokens.every((tk) => hay.includes(tk))
  })
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
watch(query, () => (page.value = 0))
watch(pages, (n) => page.value > n - 1 && (page.value = n - 1))

const rows = computed(() =>
  filtered.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE).map((r) => ({
    ...r,
    ended: Number.isFinite(Date.parse(r.endedAt)) ? dateFormat.value.format(Date.parse(r.endedAt)) : '—',
    endedAgo: relativeTime(r.endedAt, locale.value, now.value) ?? '',
    ran: r.startedAt ? (duration(r.startedAt, Date.parse(r.endedAt)) ?? '—') : '—',
    tokens: compactNumber(r.inputTokens + r.outputTokens),
    model: r.model ? (modelLabel(r.model, undefined, extras.modelNames) ?? r.model) : '—',
    work: r.workingMs ? (duration(new Date(0).toISOString(), r.workingMs) ?? '') : '',
    wait: r.waitingMs ? (duration(new Date(0).toISOString(), r.waitingMs) ?? '') : '',
    cost: r.costUsd !== undefined ? formatCost(r.costUsd, locale.value) : '—',
  })),
)
const rangeLabel = computed(() => {
  const total = filtered.value.length
  const from = page.value * PAGE_SIZE + 1
  return t('projects.range', { from: Math.min(from, total), to: Math.min(total, from + PAGE_SIZE - 1), total })
})
</script>

<template>
  <main class="mx-auto w-full max-w-[1560px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div class="min-w-0">
        <h2 class="text-2xl font-semibold tracking-tight">{{ t('history.title') }}</h2>
        <p class="mt-1 max-w-[70ch] text-sm text-ink-muted">{{ t('history.subtitle') }}</p>
      </div>
      <button
        type="button"
        class="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
        @click="ui.openRecap()"
      >
        <FileDown :size="17" aria-hidden="true" />{{ t('recap.open') }}
      </button>
    </div>

    <section aria-labelledby="timeline-title" class="mt-5 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h3 id="timeline-title" class="font-semibold">{{ t('history.timeline') }}</h3>
      <p class="mb-4 text-xs text-ink-muted">{{ t('history.timelineHint') }}</p>
      <TimelineChart />
    </section>

    <section aria-labelledby="ended-title" class="mt-5 rounded-xl border border-line bg-surface">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div class="min-w-0">
          <h3 id="ended-title" class="font-semibold">{{ t('history.ended') }}</h3>
          <p class="text-xs text-ink-muted">{{ t('history.endedHint') }}</p>
        </div>
        <label class="relative flex w-full items-center sm:w-72">
          <span class="sr-only">{{ t('history.search') }}</span>
          <Search :size="15" class="pointer-events-none absolute left-2.5 text-ink-faint" aria-hidden="true" />
          <input
            v-model="query"
            type="search"
            :placeholder="t('history.searchPlaceholder')"
            class="h-9 w-full rounded-lg border border-line bg-canvas pr-2.5 pl-8 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>
      <p v-if="!history.loaded" class="px-5 py-8 text-center text-sm text-ink-muted">{{ t('history.loading') }}</p>
      <p v-else-if="!rows.length" class="px-5 py-8 text-center text-sm text-ink-muted">
        {{ query ? t('history.noMatch') : t('history.empty') }}
      </p>
      <div v-else class="overflow-x-auto">
        <table class="w-full table-fixed text-sm">
          <colgroup>
            <col class="w-auto" />
            <col class="w-36" />
            <col class="hidden w-24 md:table-column" />
            <col class="hidden w-36 lg:table-column" />
            <col class="w-24" />
            <col class="hidden w-36 sm:table-column" />
            <col class="hidden w-20 md:table-column" />
          </colgroup>
          <thead class="text-left text-xs text-ink-muted">
            <tr class="border-b border-line">
              <th scope="col" class="px-4 py-2 font-medium sm:px-5">{{ t('history.col.session') }}</th>
              <th scope="col" class="px-3 py-2 font-medium">{{ t('history.col.ended') }}</th>
              <th scope="col" class="hidden px-3 py-2 font-medium md:table-cell">{{ t('history.col.ran') }}</th>
              <th scope="col" class="hidden px-3 py-2 font-medium lg:table-cell">{{ t('history.col.model') }}</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">{{ t('history.col.tokens') }}</th>
              <th scope="col" class="hidden px-3 py-2 font-medium sm:table-cell">{{ t('history.col.time') }}</th>
              <th scope="col" class="hidden px-3 py-2 text-right font-medium md:table-cell">{{ t('history.col.cost') }}</th>
            </tr>
          </thead>
          <TransitionGroup tag="tbody" name="ccm-list" class="relative divide-y divide-line">
            <tr v-for="r in rows" :key="r.id" class="align-top">
              <td class="min-w-0 px-4 py-2.5 sm:px-5">
                <p class="truncate font-medium" :title="r.title">{{ r.title }}</p>
                <p class="truncate font-mono text-2xs text-ink-faint" :title="r.cwd">
                  {{ shortPath(r.cwd) }}<template v-if="r.gitBranch"> · {{ r.gitBranch }}</template>
                </p>
              </td>
              <td class="px-3 py-2.5 tabular">
                <p class="truncate">{{ r.ended }}</p>
                <p class="truncate text-2xs text-ink-faint">{{ r.endedAgo }}</p>
              </td>
              <td class="hidden px-3 py-2.5 tabular md:table-cell">{{ r.ran }}</td>
              <td class="hidden truncate px-3 py-2.5 text-ink-muted lg:table-cell" :title="r.model">{{ r.model }}</td>
              <td class="px-3 py-2.5 text-right font-medium tabular">{{ r.tokens }}</td>
              <td class="hidden px-3 py-2.5 text-xs tabular sm:table-cell">
                <span v-if="r.work" class="block text-st-working">{{ t('history.worked', { d: r.work }) }}</span>
                <span v-if="r.wait" class="block text-st-waiting">{{ t('history.waited', { d: r.wait }) }}</span>
                <span v-if="!r.work && !r.wait" class="text-ink-faint">—</span>
              </td>
              <td class="hidden px-3 py-2.5 text-right text-ink-muted tabular md:table-cell">{{ r.cost }}</td>
            </tr>
          </TransitionGroup>
        </table>
      </div>
      <div v-if="pages > 1" class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-ink-muted sm:px-5">
        <span class="tabular">{{ rangeLabel }}</span>
        <Pager v-model="page" :pages="pages" />
      </div>
    </section>
  </main>
</template>
