<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, Puzzle, SearchCheck, TriangleAlert } from 'lucide-vue-next'
import type { ExtStatus, ToolStatDays, ToolStatEntry } from '@ccm/shared'
import { desktop, hasExtensions } from '../../lib/desktop'
import { compactNumber, shortPath } from '../../lib/format'
import { barScale, errorRate, STAT_GROUPS, TOP_ROWS, unusedItems, type StatGroup } from '../../lib/toolStats'
import { useConnectionStore } from '../../stores/connection'
import { useExtensionsStore } from '../../stores/extensions'
import { useHistoryStore } from '../../stores/history'
import { useUiStore } from '../../stores/ui'
import AppSelect from '../AppSelect.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'

const { t, locale } = useI18n()
const history = useHistoryStore()
const connection = useConnectionStore()
const ext = useExtensionsStore()
const ui = useUiStore()

const days = ref<ToolStatDays>(30)
const project = ref<string | null>(null)
const expanded = ref<Partial<Record<StatGroup, boolean>>>({})

function load(): void {
  connection.loadToolStats(days.value, project.value)
}
load()
watch([days, project], () => {
  expanded.value = {}
  unusedStatus.value = null
  unusedState.value = 'idle'
  load()
})
watch(
  () => connection.state,
  (s) => s === 'connected' && load(),
)

const stats = computed(() => {
  const s = history.toolStats
  return s && s.days === days.value && s.project === project.value ? s : null
})
const knownProjects = ref<string[]>([])
watch(
  () => history.toolStats?.projects,
  (list) => list && (knownProjects.value = list),
)
const projectOptions = computed(() => [
  { value: null, label: t('toolStats.allProjects') },
  ...knownProjects.value.map((p) => ({ value: p, label: shortPath(p), hint: p })),
])
const dayOptions = computed(() => ([7, 30] as const).map((n) => ({ value: n, label: t('toolStats.days', { n }) })))
const pct = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }))
const empty = computed(() => !!stats.value && STAT_GROUPS.every((g) => !stats.value![g].length))

function rows(group: StatGroup): ToolStatEntry[] {
  const list = stats.value?.[group] ?? []
  return expanded.value[group] ? list : list.slice(0, TOP_ROWS)
}
const maxOf = (group: StatGroup): number => stats.value?.[group][0]?.n ?? 0

const unusedState = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
const unusedStatus = ref<ExtStatus | null>(null)
const unused = computed(() => (unusedState.value === 'ready' ? unusedItems(unusedStatus.value, stats.value) : []))

/** Spawns `claude plugin list`, so it runs on the button, not on every visit. */
async function findUnused(): Promise<void> {
  if (!desktop?.extStatus) return
  unusedState.value = 'loading'
  const asked = project.value
  const s = await desktop.extStatus(asked ?? undefined).catch(() => null)
  if (asked !== project.value) return
  unusedStatus.value = s
  unusedState.value = s ? 'ready' : 'failed'
}

function openExtensions(): void {
  ext.mode = project.value ? 'project' : 'global'
  if (project.value) ext.project = project.value
  ui.setView('extensions')
}
</script>

<template>
  <div class="flex flex-col gap-4" data-tool-stats>
    <div class="flex flex-wrap items-center gap-2">
      <AppSelect v-model="project" :options="projectOptions" :label="t('toolStats.project')" size="sm" data-tool-stats-project />
      <SegmentedControl v-model="days" :options="dayOptions" :label="t('toolStats.range')" />
    </div>
    <p v-if="!stats" class="text-xs text-ink-muted" role="status">{{ t('toolStats.loading') }}</p>
    <p v-else-if="empty" class="text-xs text-ink-muted">{{ t('toolStats.empty') }}</p>
    <div v-else class="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
      <section v-for="g in STAT_GROUPS" :key="g" :aria-labelledby="`ts-${g}`" class="min-w-0" :data-tool-stats-group="g">
        <h4 :id="`ts-${g}`" class="mb-1.5 text-xs font-semibold text-ink-muted">{{ t(`toolStats.group.${g}`) }}</h4>
        <p v-if="!stats[g].length" class="text-xs text-ink-faint">{{ t('toolStats.none') }}</p>
        <ul v-else class="flex flex-col">
          <li
            v-for="e in rows(g)"
            :key="e.name"
            class="grid h-7 grid-cols-[minmax(0,1fr)_minmax(2rem,0.8fr)_3rem] items-center gap-x-2 text-xs"
            :title="`${e.name}\n${t('toolStats.calls', { n: e.n }, e.n)}`"
          >
            <span class="flex min-w-0 items-center gap-1">
              <span class="truncate font-mono text-ink">{{ e.name }}</span>
              <span
                v-if="e.errors"
                class="inline-flex shrink-0 items-center gap-0.5 text-2xs text-warning tabular"
                :title="t('toolStats.errorsTitle', { n: e.errors, total: e.n })"
                data-tool-stats-errors
              >
                <TriangleAlert :size="10" aria-hidden="true" />{{ t('toolStats.errors', { pct: pct.format(errorRate(e) ?? 0) }) }}
              </span>
            </span>
            <span class="block h-1.5 min-w-0 rounded-full bg-fill" aria-hidden="true">
              <span class="block h-full origin-left rounded-full bg-accent transition-transform duration-(--ccm-dur-slow) ease-out-quint" :style="{ transform: `scaleX(${barScale(e.n, maxOf(g))})` }" />
            </span>
            <span class="text-right font-medium text-ink tabular">{{ compactNumber(e.n) }}</span>
          </li>
        </ul>
        <button
          v-if="stats[g].length > TOP_ROWS"
          type="button"
          class="ccm-btn-plain mt-1 h-6 px-1 text-2xs text-accent-ink"
          :aria-expanded="!!expanded[g]"
          @click="expanded = { ...expanded, [g]: !expanded[g] }"
        >
          {{ expanded[g] ? t('toolStats.showLess') : t('toolStats.showAll', { n: stats[g].length }) }}
        </button>
      </section>
    </div>

    <section v-if="hasExtensions && stats" aria-labelledby="ts-unused" class="border-t border-line pt-4" data-tool-stats-unused>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <h4 id="ts-unused" class="text-xs font-semibold text-ink">{{ t('toolStats.unused.title') }}</h4>
          <p class="max-w-[80ch] text-2xs text-ink-muted">{{ t('toolStats.unused.hint') }}</p>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="ccm-btn h-7 gap-1 text-xs" :disabled="unusedState === 'loading'" data-tool-stats-find @click="findUnused">
            <LoaderCircle v-if="unusedState === 'loading'" :size="12" class="ccm-spin" aria-hidden="true" />
            <SearchCheck v-else :size="12" aria-hidden="true" />{{ t('toolStats.unused.check') }}
          </button>
          <button
            v-if="unused.length"
            type="button"
            class="ccm-btn h-7 gap-1 text-xs"
            :title="t('toolStats.unused.openHint')"
            data-tool-stats-open-ext
            @click="openExtensions"
          >
            <Puzzle :size="12" aria-hidden="true" />{{ t('toolStats.unused.open') }}
          </button>
        </div>
      </div>
      <p v-if="unusedState === 'loading'" class="mt-2 text-xs text-ink-muted" role="status">{{ t('toolStats.unused.checking') }}</p>
      <p v-else-if="unusedState === 'failed'" class="mt-2 text-xs text-warning" role="alert">{{ t('toolStats.unused.failed') }}</p>
      <p v-else-if="unusedState === 'ready' && !unused.length" class="mt-2 text-xs text-ink-muted">{{ t('toolStats.unused.none') }}</p>
      <ul v-else-if="unused.length" class="mt-2 flex flex-wrap gap-1.5" data-tool-stats-unused-list>
        <li v-for="u in unused" :key="`${u.kind}:${u.name}`" class="inline-flex h-6 max-w-full items-center gap-1.5 rounded-inner bg-fill px-2 text-2xs">
          <span class="text-ink-faint">{{ u.kind === 'skill' ? t('toolStats.unused.skill') : t('toolStats.unused.mcp') }}</span>
          <span class="truncate font-mono text-ink" :title="u.name">{{ u.name }}</span>
          <span class="text-ink-faint">{{ t(`toolStats.unused.scope.${u.scope}`) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
