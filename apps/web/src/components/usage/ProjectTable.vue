<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, FolderGit2, HardDrive, LoaderCircle, Rows2, Rows3, Rows4, Search, X } from 'lucide-vue-next'
import { baseName, compactNumber, formatCost, formatDay, fullNumber } from '../../lib/format'
import { useUsageStore, type ProjectRow } from '../../stores/usage'
import AppSelect from '../AppSelect.vue'
import ArtImage from '../ArtImage.vue'

const props = withDefaults(defineProps<{ picker?: boolean; autofocus?: boolean }>(), { picker: false, autofocus: false })
const emit = defineEmits<{ pick: [id: string | null] }>()

const PAGE_SIZES = [25, 50, 100, 200, 500] as const
const pageSizeOptions = PAGE_SIZES.map((n) => ({ value: n as number, label: String(n) }))
const SEARCH_DEBOUNCE_MS = 180

type SortKey = 'name' | 'messages' | 'input' | 'output' | 'cacheWrite' | 'cacheRead' | 'tokens' | 'cost' | 'activeDays' | 'lastDay'

const { t, locale } = useI18n()
const usage = useUsageStore()

function readPageSize(): number {
  try {
    const n = Number(localStorage.getItem('ccm.projectPageSize'))
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : 25
  } catch {
    return 25
  }
}

const query = ref('')
const appliedQuery = ref('')
const searching = ref(false)
const drive = ref<string | null>(null)
const sortKey = ref<SortKey>(usage.metric === 'cost' ? 'cost' : 'tokens')
const sortDesc = ref(true)
const pageSize = ref(readPageSize())
const page = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)

let timer: number | undefined
watch(query, (value) => {
  window.clearTimeout(timer)
  searching.value = true
  timer = window.setTimeout(() => {
    appliedQuery.value = value.trim().toLowerCase()
    searching.value = false
  }, SEARCH_DEBOUNCE_MS)
})
onBeforeUnmount(() => window.clearTimeout(timer))

watch(pageSize, (value) => {
  try {
    localStorage.setItem('ccm.projectPageSize', String(value))
  } catch {
    return
  }
})
watch([appliedQuery, drive, pageSize, sortKey, sortDesc, () => usage.range, () => usage.model, () => usage.groupRepos], () => (page.value = 0))

const drives = computed(() => {
  const counts = new Map<string, number>()
  for (const r of usage.projectRows) counts.set(r.drive, (counts.get(r.drive) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, count]) => ({ id, count }))
})

const grandTotal = computed(() => usage.projectRows.reduce((s, r) => s + (usage.metric === 'cost' ? r.cost : r.tokens), 0))

const filtered = computed(() => {
  const q = appliedQuery.value
  return usage.projectRows.filter((r) => (!drive.value || r.drive === drive.value) && (!q || r.id.toLowerCase().includes(q)))
})

const sorted = computed(() => {
  const key = sortKey.value
  const dir = sortDesc.value ? -1 : 1
  const val = (r: ProjectRow): number | string => (key === 'name' ? baseName(r.id).toLowerCase() : r[key])
  return [...filtered.value].sort((a, b) => {
    const x = val(a)
    const y = val(b)
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id.localeCompare(b.id)
  })
})

const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize.value)))
const rows = computed(() => sorted.value.slice(page.value * pageSize.value, (page.value + 1) * pageSize.value))
const rangeLabel = computed(() => {
  const n = sorted.value.length
  if (n === 0) return t('projects.none')
  const from = page.value * pageSize.value + 1
  return t('projects.range', { from, to: Math.min(n, from + pageSize.value - 1), total: n })
})

const columns = computed<{ key: SortKey; label: string }[]>(() => [
  { key: 'messages', label: t('projects.col.messages') },
  { key: 'input', label: t('usage.series.input') },
  { key: 'output', label: t('usage.series.output') },
  { key: 'cacheWrite', label: t('usage.series.cacheWrite') },
  { key: 'cacheRead', label: t('usage.series.cacheRead') },
  { key: 'tokens', label: t('projects.col.tokens') },
  { key: 'cost', label: t('usage.cost') },
  { key: 'activeDays', label: t('projects.col.days') },
  { key: 'lastDay', label: t('projects.col.last') },
])

const headers = computed(() => [{ key: 'name' as SortKey, label: t('usage.project') }, ...columns.value])

const DEFAULT_WIDTHS: Record<SortKey, number> = {
  name: 380,
  messages: 96,
  input: 96,
  output: 96,
  cacheWrite: 112,
  cacheRead: 112,
  tokens: 104,
  cost: 96,
  activeDays: 88,
  lastDay: 112,
}
const MIN_WIDTH = 64
const MIN_NAME_WIDTH = 160
const minWidth = (key: SortKey) => (key === 'name' ? MIN_NAME_WIDTH : MIN_WIDTH)

function readWidths(): Partial<Record<SortKey, number>> {
  try {
    const raw = JSON.parse(localStorage.getItem('ccm.projectCols') ?? '{}') as Record<string, unknown>
    const out: Partial<Record<SortKey, number>> = {}
    for (const key of Object.keys(DEFAULT_WIDTHS) as SortKey[]) {
      const n = raw[key]
      if (typeof n === 'number' && Number.isFinite(n)) out[key] = Math.max(minWidth(key), Math.round(n))
    }
    return out
  } catch {
    return {}
  }
}

const customWidths = ref(readWidths())
const widthOf = (key: SortKey) => customWidths.value[key] ?? DEFAULT_WIDTHS[key]
const tableWidth = computed(() => headers.value.reduce((s, c) => s + widthOf(c.key), 0))
const customized = computed(() => Object.keys(customWidths.value).length > 0)

function saveWidths(): void {
  try {
    localStorage.setItem('ccm.projectCols', JSON.stringify(customWidths.value))
  } catch {
    return
  }
}

function setWidth(key: SortKey, px: number): void {
  customWidths.value = { ...customWidths.value, [key]: Math.max(minWidth(key), Math.round(px)) }
}

function resetWidth(key: SortKey): void {
  const { [key]: _, ...rest } = customWidths.value
  customWidths.value = rest
  saveWidths()
}

function resetWidths(): void {
  customWidths.value = {}
  saveWidths()
}

function startColumnResize(key: SortKey, e: PointerEvent): void {
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const startX = e.clientX
  const startW = widthOf(key)
  const move = (ev: PointerEvent) => setWidth(key, startW + ev.clientX - startX)
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', up)
    saveWidths()
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', up)
}

function nudgeColumn(key: SortKey, delta: number): void {
  setWidth(key, widthOf(key) + delta)
  saveWidths()
}

type Density = 'compact' | 'normal' | 'expanded'
const DENSITIES: Density[] = ['compact', 'normal', 'expanded']

function readDensity(): Density {
  try {
    const v = localStorage.getItem('ccm.projectDensity')
    return (DENSITIES as string[]).includes(v ?? '') ? (v as Density) : 'normal'
  } catch {
    return 'normal'
  }
}

const density = ref<Density>(readDensity())
watch(density, (value) => {
  try {
    localStorage.setItem('ccm.projectDensity', value)
  } catch {
    return
  }
})
const densityIcon = { compact: Rows4, normal: Rows3, expanded: Rows2 } as const
const cellPad = computed(() => (density.value === 'compact' ? 'py-1.5' : density.value === 'expanded' ? 'py-3.5' : 'py-2.5'))
const wrapText = computed(() => (density.value === 'expanded' ? 'whitespace-normal break-all' : 'truncate'))

function sortBy(key: SortKey): void {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value
  else {
    sortKey.value = key
    sortDesc.value = key !== 'name'
  }
}

const ariaSort = (key: SortKey) => (sortKey.value === key ? (sortDesc.value ? 'descending' : 'ascending') : 'none')
const share = (r: ProjectRow) => (grandTotal.value > 0 ? ((usage.metric === 'cost' ? r.cost : r.tokens) / grandTotal.value) * 100 : 0)
const cost = (r: ProjectRow) => (r.cost > 0 || r.unpriced === 0 ? formatCost(r.cost, locale.value) : '—')

function cell(r: ProjectRow, key: SortKey): string {
  switch (key) {
    case 'cost':
      return cost(r)
    case 'lastDay':
      return formatDay(r.lastDay, locale.value)
    case 'activeDays':
      return String(r.activeDays)
    case 'name':
      return baseName(r.id)
    default:
      return compactNumber(r[key])
  }
}

function exact(r: ProjectRow, key: SortKey): string | undefined {
  if (key === 'tokens') return fullNumber(r.tokens, locale.value)
  if (key === 'messages') return fullNumber(r.messages, locale.value)
  return undefined
}

function pick(id: string): void {
  if (props.picker) emit('pick', id)
  else usage.project = usage.project === id ? null : id
}

function clearSearch(): void {
  query.value = ''
  searchInput.value?.focus()
}

defineExpose({ focus: () => searchInput.value?.focus() })
</script>

<template>
  <div class="min-w-0">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-[200px] flex-1">
        <Search :size="16" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <label class="sr-only" :for="picker ? 'project-search-dialog' : 'project-search'">{{ t('projects.search') }}</label>
        <input
          :id="picker ? 'project-search-dialog' : 'project-search'"
          ref="searchInput"
          v-model="query"
          type="search"
          :autofocus="autofocus"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('projects.searchPlaceholder')"
          class="h-10 w-full rounded-xl border border-line bg-canvas pr-10 pl-9 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent [&::-webkit-search-cancel-button]:hidden"
        />
        <span class="absolute top-1/2 right-2 -translate-y-1/2">
          <LoaderCircle v-if="searching" :size="16" class="animate-spin text-ink-faint motion-reduce:animate-none" :aria-label="t('projects.searching')" />
          <button
            v-else-if="query"
            type="button"
            class="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-faint hover:bg-raised hover:text-ink"
            :aria-label="t('projects.clearSearch')"
            @click="clearSearch"
          >
            <X :size="15" aria-hidden="true" />
          </button>
        </span>
      </div>

      <button
        type="button"
        class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors"
        :class="usage.groupRepos ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted hover:bg-raised hover:text-ink'"
        :aria-pressed="usage.groupRepos"
        :title="t('projects.groupReposHint')"
        @click="usage.groupRepos = !usage.groupRepos"
      >
        <FolderGit2 :size="14" aria-hidden="true" />{{ t('projects.groupRepos') }}
      </button>

      <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('projects.drive')">
        <button
          type="button"
          class="inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-xs font-medium transition-colors"
          :class="drive === null ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-raised hover:text-ink'"
          :aria-pressed="drive === null"
          @click="drive = null"
        >
          {{ t('projects.allDrives') }}
        </button>
        <button
          v-for="d in drives"
          :key="d.id"
          type="button"
          class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors"
          :class="drive === d.id ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-raised hover:text-ink'"
          :aria-pressed="drive === d.id"
          @click="drive = drive === d.id ? null : d.id"
        >
          <HardDrive :size="14" aria-hidden="true" />{{ d.id }}
          <span class="text-ink-faint tabular">{{ d.count }}</span>
        </button>
      </div>

      <div class="flex items-center gap-1" role="group" :aria-label="t('projects.density')">
        <button
          v-for="d in DENSITIES"
          :key="d"
          type="button"
          class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg transition-colors"
          :class="density === d ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-raised hover:text-ink'"
          :aria-pressed="density === d"
          :aria-label="t(`projects.densityLevel.${d}`)"
          :title="t(`projects.densityLevel.${d}`)"
          @click="density = d"
        >
          <component :is="densityIcon[d]" :size="16" aria-hidden="true" />
        </button>
        <button
          v-if="customized"
          type="button"
          class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-ink-muted hover:bg-raised hover:text-ink"
          @click="resetWidths"
        >
          <Columns3 :size="14" aria-hidden="true" />{{ t('projects.resetColumns') }}
        </button>
      </div>
    </div>

    <div class="mt-3 overflow-x-auto rounded-xl border border-line" :aria-busy="searching">
      <table class="table-fixed border-collapse text-sm" :style="{ width: `max(100%, ${tableWidth}px)` }">
        <colgroup>
          <col :style="{ width: `${widthOf('name')}px` }" />
          <col v-for="c in columns" :key="c.key" :style="{ width: `${widthOf(c.key)}px` }" />
        </colgroup>
        <thead class="bg-raised text-left text-xs text-ink-muted">
          <tr>
            <th
              v-for="c in headers"
              :key="c.key"
              scope="col"
              class="relative px-3 py-2 font-medium select-none"
              :class="c.key === 'name' ? '' : 'text-right'"
              :aria-sort="ariaSort(c.key)"
            >
              <button
                type="button"
                class="inline-flex max-w-full cursor-pointer items-center gap-1 whitespace-nowrap hover:text-ink"
                :class="c.key === 'name' ? '' : 'flex-row-reverse'"
                @click="sortBy(c.key)"
              >
                <span class="truncate">{{ c.label }}</span>
                <component :is="sortDesc ? ArrowDown : ArrowUp" v-if="sortKey === c.key" :size="13" class="shrink-0" aria-hidden="true" />
              </button>
              <span
                role="separator"
                aria-orientation="vertical"
                tabindex="0"
                :aria-label="t('projects.resizeColumn', { col: c.label })"
                :aria-valuenow="widthOf(c.key)"
                :aria-valuemin="minWidth(c.key)"
                :title="t('projects.resizeColumn', { col: c.label })"
                class="group absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none"
                @pointerdown.prevent.stop="startColumnResize(c.key, $event)"
                @click.stop
                @dblclick.stop="resetWidth(c.key)"
                @keydown.left.prevent="nudgeColumn(c.key, -16)"
                @keydown.right.prevent="nudgeColumn(c.key, 16)"
              >
                <span class="my-1.5 w-0.5 rounded-full bg-line transition-colors group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line transition-opacity duration-150" :class="searching ? 'opacity-60' : ''">
          <tr v-if="rows.length === 0">
            <td :colspan="columns.length + 1" class="px-3 py-8 text-center text-ink-muted">
              <div class="sticky left-0 mx-auto flex max-w-[calc(100vw-4rem)] flex-col items-center gap-2">
                <ArtImage name="empty-project-search" class="w-36" />
                {{ t('projects.empty') }}
              </div>
            </td>
          </tr>
          <tr
            v-for="r in rows"
            :key="r.id"
            class="cursor-pointer transition-colors hover:bg-raised"
            :class="usage.project === r.id ? 'bg-accent-soft' : ''"
            tabindex="0"
            :aria-current="usage.project === r.id ? 'true' : undefined"
            @click="pick(r.id)"
            @keydown.enter.prevent="pick(r.id)"
            @keydown.space.prevent="pick(r.id)"
          >
            <td class="px-3" :class="cellPad">
              <div class="flex min-w-0 items-center gap-2">
                <span class="w-7 shrink-0 self-start rounded bg-raised py-px text-center font-mono text-2xs text-ink-muted">{{ r.drive }}</span>
                <div class="min-w-0 flex-1">
                  <p class="font-medium" :class="[wrapText, usage.project === r.id ? 'text-accent' : '']" :title="r.id">{{ baseName(r.id) }}</p>
                  <p v-if="density !== 'compact'" class="font-mono text-2xs text-ink-faint" :class="wrapText" :title="r.id">
                    {{ r.id }}<template v-if="r.folders > 1"> · {{ t('projects.folders', { n: r.folders }) }}</template>
                  </p>
                </div>
              </div>
              <div class="ml-9 h-1 rounded-full bg-raised" :class="density === 'compact' ? 'mt-1' : 'mt-1.5'" aria-hidden="true">
                <div class="h-full origin-left rounded-full bg-accent" :style="{ transform: `scaleX(${Math.max(0.005, share(r) / 100)})` }" />
              </div>
            </td>
            <td
              v-for="c in columns"
              :key="c.key"
              class="truncate px-3 text-right tabular"
              :class="[cellPad, c.key === sortKey ? 'font-semibold text-ink' : 'text-ink-muted']"
              :title="exact(r, c.key)"
            >
              {{ cell(r, c.key) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
      <span class="tabular" aria-live="polite">{{ rangeLabel }}</span>
      <div class="flex items-center gap-2">
        <span class="flex items-center gap-1.5">
          <span aria-hidden="true">{{ t('projects.perPage') }}</span>
          <AppSelect v-model="pageSize" :options="pageSizeOptions" :label="t('projects.perPage')" size="sm" />
        </span>
        <button
          type="button"
          class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="page === 0"
          :aria-label="t('projects.prev')"
          @click="page--"
        >
          <ChevronLeft :size="16" aria-hidden="true" />
        </button>
        <span class="tabular">{{ t('projects.page', { page: page + 1, pages: pageCount }) }}</span>
        <button
          type="button"
          class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="page >= pageCount - 1"
          :aria-label="t('projects.next')"
          @click="page++"
        >
          <ChevronRight :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
