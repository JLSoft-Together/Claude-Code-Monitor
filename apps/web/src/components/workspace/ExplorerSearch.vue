<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CaseSensitive, ChevronDown, ChevronRight, FileText, LoaderCircle, Regex, ReplaceAll, WholeWord, X } from 'lucide-vue-next'
import { joinPath } from '../../lib/fileLinks'
import { hasReplaceFiles, replaceFiles, searchFiles, type ReplaceFileResult, type SearchMatch, type SearchQuery, type SearchResult } from '../../lib/preview'
import { sameRange, uniformRange, type RowRange } from '../../lib/rowWindow'
import { fileCount, fileTick, highlighter, hitRuns, replacePlan, replaceRuns, searchRows } from '../../lib/searchView'

const props = defineProps<{ root: string }>()
const emit = defineEmits<{ open: [path: string, keep: boolean, line: number] }>()

const { t } = useI18n()
const ROW_H = 22
const DEBOUNCE_MS = 250

const text = ref('')
const opts = ref({ regex: false, caseSensitive: false, word: false })
const matches = shallowRef<SearchMatch[]>([])
const truncated = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)
const searched = ref<SearchQuery | null>(null)
const collapsed = ref(new Set<string>())
const input = ref<HTMLInputElement | null>(null)
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const query = computed<SearchQuery | null>(() => (text.value.trim() ? { q: text.value, ...opts.value } : null))

async function run(q: SearchQuery | null): Promise<void> {
  const my = ++seq
  if (!q) {
    busy.value = false
    matches.value = []
    truncated.value = false
    error.value = null
    searched.value = null
    return
  }
  busy.value = true
  const res: SearchResult = await searchFiles(props.root, q)
  if (my !== seq) return
  busy.value = false
  if (!res.ok) {
    if (res.error === 'cancelled') return
    error.value = t(`workspace.search.error.${res.error}`, { detail: res.detail ?? '' })
    matches.value = []
    truncated.value = false
    return
  }
  error.value = null
  collapsed.value = new Set()
  skipped.value = new Set()
  matches.value = res.matches
  truncated.value = res.truncated
  searched.value = q
}

watch(
  [query, () => props.root],
  ([q]) => {
    clearTimeout(timer)
    timer = setTimeout(() => void run(q), q ? DEBOUNCE_MS : 0)
  },
  { deep: true },
)
onBeforeUnmount(() => {
  clearTimeout(timer)
  seq++
})

const re = computed(() => (searched.value ? highlighter(searched.value) : null))
const rows = computed(() => searchRows(matches.value, collapsed.value))
const files = computed(() => fileCount(matches.value))

const scroller = ref<HTMLElement | null>(null)
const range = ref<RowRange>({ start: 0, end: 0 })
function measure(): void {
  const el = scroller.value
  const next = uniformRange(rows.value.length, ROW_H, el?.scrollTop ?? 0, el?.clientHeight ?? 600)
  if (!sameRange(next, range.value)) range.value = next
}
watch(rows, () => requestAnimationFrame(measure), { flush: 'post' })
const shown = computed(() => rows.value.slice(range.value.start, range.value.end))

function toggleFile(path: string): void {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed.value = next
}

const abs = (rel: string): string => joinPath(props.root, rel)
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

const TOGGLES = [
  { key: 'caseSensitive', icon: CaseSensitive },
  { key: 'word', icon: WholeWord },
  { key: 'regex', icon: Regex },
] as const

function clear(): void {
  text.value = ''
  input.value?.focus()
}

const replaceOpen = ref(false)
const replacement = ref('')
const skipped = ref(new Set<number>())
const replacing = ref(false)
const report = ref<{ files: number; count: number; failed: Extract<ReplaceFileResult, { ok: false }>[] } | { error: string } | null>(null)
const plan = computed(() => replacePlan(matches.value, skipped.value))
const canReplace = computed(() => !!searched.value && !!re.value && !busy.value && !replacing.value && plan.value.lines > 0)

watch(query, () => (report.value = null), { deep: true })

function toggleMatch(index: number): void {
  const next = new Set(skipped.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  skipped.value = next
}

function toggleFileTick(first: number, count: number): void {
  const next = new Set(skipped.value)
  const on = fileTick(first, count, next) !== 'all'
  for (let k = first; k < first + count; k++) {
    if (on) next.delete(k)
    else next.add(k)
  }
  skipped.value = next
}

async function replaceAll(): Promise<void> {
  const q = searched.value
  if (!q || !canReplace.value) return
  replacing.value = true
  const res = await replaceFiles(props.root, q, replacement.value, plan.value.files)
  replacing.value = false
  if (!res.ok) {
    report.value = res.error === 'cancelled' ? null : { error: t(`workspace.search.replaceError.${res.error}`) }
    return
  }
  report.value = { files: res.files, count: res.count, failed: res.results.filter((r): r is Extract<ReplaceFileResult, { ok: false }> => !r.ok) }
  const keep = report.value
  await run(q)
  report.value = keep
}

/** Find usages / declaration from the editor: fills the query and its options, then searches. */
function seed(q: SearchQuery): void {
  opts.value = { regex: q.regex, caseSensitive: q.caseSensitive, word: q.word }
  text.value = q.q
}

defineExpose({ focus: () => input.value?.select() ?? input.value?.focus(), seed })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1">
    <div class="flex shrink-0 items-start gap-0.5">
      <button
        v-if="hasReplaceFiles"
        type="button"
        class="mt-0.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-inner text-ink-muted hover:bg-fill hover:text-ink"
        :aria-expanded="replaceOpen"
        :title="t('workspace.search.toggleReplace')"
        :aria-label="t('workspace.search.toggleReplace')"
        data-search-replace-toggle
        @click="replaceOpen = !replaceOpen"
      >
        <component :is="replaceOpen ? ChevronDown : ChevronRight" :size="14" aria-hidden="true" />
      </button>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex shrink-0 items-center gap-0.5 rounded-inner border border-line bg-control px-1.5 focus-within:ring-2 focus-within:ring-focus">
          <input
            ref="input"
            v-model="text"
            type="search"
            spellcheck="false"
            class="h-7 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
            :placeholder="t('workspace.search.placeholder')"
            :aria-label="t('workspace.search.placeholder')"
            @keydown.esc.prevent="clear"
          />
          <button v-if="text" type="button" class="ccm-btn-plain size-5 justify-center p-0" :title="t('workspace.search.clear')" :aria-label="t('workspace.search.clear')" @click="clear">
            <X :size="12" aria-hidden="true" />
          </button>
          <button
            v-for="o in TOGGLES"
            :key="o.key"
            type="button"
            class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-inner text-ink-muted hover:bg-fill hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-accent-ink"
            :aria-pressed="opts[o.key]"
            :title="t(`workspace.search.${o.key}`)"
            :aria-label="t(`workspace.search.${o.key}`)"
            @click="opts[o.key] = !opts[o.key]"
          >
            <component :is="o.icon" :size="14" aria-hidden="true" />
          </button>
        </div>
        <div v-if="replaceOpen" class="flex shrink-0 items-center gap-0.5 rounded-inner border border-line bg-control px-1.5 focus-within:ring-2 focus-within:ring-focus">
          <input
            v-model="replacement"
            type="text"
            spellcheck="false"
            maxlength="1000"
            class="h-7 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
            :placeholder="t('workspace.search.replacePlaceholder')"
            :aria-label="t('workspace.search.replacePlaceholder')"
            :title="opts.regex ? t('workspace.search.regexHint') : undefined"
            data-search-replace
            @keydown.enter.prevent="replaceAll"
          />
          <button
            type="button"
            class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-inner text-ink-muted hover:bg-fill hover:text-ink disabled:cursor-default disabled:opacity-40"
            :disabled="!canReplace"
            :title="t('workspace.search.replaceAll', { n: plan.lines, files: plan.files.length }, plan.lines)"
            :aria-label="t('workspace.search.replaceAll', { n: plan.lines, files: plan.files.length }, plan.lines)"
            data-search-replace-all
            @click="replaceAll"
          >
            <LoaderCircle v-if="replacing" :size="14" class="ccm-spin" aria-hidden="true" />
            <ReplaceAll v-else :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
    <p v-if="replaceOpen && searched && !re" class="shrink-0 px-1 text-2xs text-warning">{{ t('workspace.search.replaceUnsupported') }}</p>
    <div v-if="report" class="shrink-0 rounded-inner border border-line bg-fill px-2 py-1 text-2xs text-ink" role="status" data-search-replace-report>
      <p v-if="'error' in report" class="text-st-error">{{ report.error }}</p>
      <template v-else>
        <p>{{ t('workspace.search.replaced', { n: report.count, files: report.files }, report.count) }}</p>
        <template v-if="report.failed.length">
          <p class="mt-0.5 text-warning">{{ t('workspace.search.skippedTitle', { n: report.failed.length }, report.failed.length) }}</p>
          <ul class="ccm-scroll max-h-24 overflow-y-auto">
            <li v-for="f in report.failed" :key="f.path" class="flex min-w-0 gap-1">
              <button type="button" class="min-w-0 cursor-pointer truncate text-left font-mono hover:underline" :title="f.path" @click="emit('open', abs(f.path), false, 1)">{{ f.path }}</button>
              <span class="shrink-0 text-ink-muted">{{ t(`workspace.search.skip.${f.error}`) }}</span>
            </li>
          </ul>
        </template>
      </template>
    </div>

    <p class="flex shrink-0 items-center gap-1 px-1 text-2xs text-ink-muted" role="status" aria-live="polite">
      <LoaderCircle v-if="busy" :size="12" class="ccm-spin" aria-hidden="true" />
      <span v-if="error" class="text-st-error">{{ error }}</span>
      <template v-else-if="searched">
        <span>{{ t('workspace.search.summary', { n: matches.length, files }, matches.length) }}</span>
        <span v-if="truncated">· {{ t('workspace.search.truncated') }}</span>
      </template>
      <span v-else-if="!busy">{{ t('workspace.search.hint') }}</span>
    </p>

    <div ref="scroller" class="ccm-scroll min-h-0 flex-1 overflow-y-auto" @scroll.passive="measure">
      <div :style="{ height: `${rows.length * ROW_H}px`, position: 'relative' }">
        <ul :style="{ position: 'absolute', insetInline: 0, top: `${range.start * ROW_H}px` }" role="list">
          <li v-for="row in shown" :key="row.kind === 'file' ? `f:${row.path}` : `m:${row.index}`" class="flex items-center" :style="{ height: `${ROW_H}px` }">
            <input
              v-if="replaceOpen && row.kind === 'file'"
              type="checkbox"
              class="ml-1 shrink-0 cursor-pointer accent-accent"
              :checked="fileTick(row.first, row.count, skipped) === 'all'"
              :indeterminate="fileTick(row.first, row.count, skipped) === 'some'"
              :title="t('workspace.search.includeFile')"
              :aria-label="t('workspace.search.includeFile')"
              data-search-tick-file
              @change="toggleFileTick(row.first, row.count)"
            />
            <input
              v-else-if="replaceOpen && row.kind === 'match'"
              type="checkbox"
              class="ml-5 shrink-0 cursor-pointer accent-accent"
              :checked="!skipped.has(row.index)"
              :title="t('workspace.search.include')"
              :aria-label="t('workspace.search.include')"
              data-search-tick
              @change="toggleMatch(row.index)"
            />
            <button
              v-if="row.kind === 'file'"
              type="button"
              class="flex h-full w-full min-w-0 cursor-pointer items-center gap-1 rounded-inner px-1 text-left text-xs hover:bg-fill"
              :aria-expanded="!row.collapsed"
              :title="row.path"
              @click="toggleFile(row.path)"
            >
              <component :is="row.collapsed ? ChevronRight : ChevronDown" :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
              <FileText :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
              <span class="shrink-0 font-medium text-ink">{{ baseOf(row.path) }}</span>
              <span class="min-w-0 flex-1 truncate text-2xs text-ink-faint">{{ dirOf(row.path) }}</span>
              <span class="shrink-0 rounded-full bg-fill px-1.5 text-2xs text-ink-muted tabular">{{ row.count }}</span>
            </button>
            <button
              v-else
              type="button"
              class="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner pr-1 text-left font-mono text-2xs hover:bg-fill"
              :class="replaceOpen ? 'pl-1' : 'pl-6'"
              :title="`${row.path}:${row.line}`"
              @click="emit('open', abs(row.path), false, row.line)"
              @dblclick="emit('open', abs(row.path), true, row.line)"
            >
              <span class="w-8 shrink-0 text-right text-ink-faint tabular">{{ row.line }}</span>
              <span
                v-if="replaceOpen && re"
                class="min-w-0 flex-1 truncate whitespace-pre text-ink-muted"
                :class="{ 'opacity-50': skipped.has(row.index) }"
                ><template v-for="(p, i) in replaceRuns(row.text, re, replacement, searched?.regex ?? false)" :key="i"
                  ><del v-if="p.kind === 'del'" class="rounded-[2px] bg-diff-del-soft text-diff-del">{{ p.text }}</del
                  ><ins v-else-if="p.kind === 'ins'" class="rounded-[2px] bg-diff-add-soft font-semibold text-diff-add no-underline">{{ p.text }}</ins
                  ><template v-else>{{ p.text }}</template></template
                ></span
              >
              <span v-else class="min-w-0 flex-1 truncate whitespace-pre text-ink-muted"
                ><template v-for="(p, i) in hitRuns(row.text, re)" :key="i"
                  ><mark v-if="p.hit" class="rounded-[2px] bg-accent-soft font-semibold text-accent-ink">{{ p.text }}</mark
                  ><template v-else>{{ p.text }}</template></template
                ></span
              >
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
