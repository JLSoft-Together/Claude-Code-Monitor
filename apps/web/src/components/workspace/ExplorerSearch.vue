<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CaseSensitive, ChevronDown, ChevronRight, FileText, LoaderCircle, Regex, WholeWord, X } from 'lucide-vue-next'
import { joinPath } from '../../lib/fileLinks'
import { searchFiles, type SearchMatch, type SearchQuery, type SearchResult } from '../../lib/preview'
import { sameRange, uniformRange, type RowRange } from '../../lib/rowWindow'
import { fileCount, highlighter, hitRuns, searchRows } from '../../lib/searchView'

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

/** Find usages / declaration from the editor: fills the query and its options, then searches. */
function seed(q: SearchQuery): void {
  opts.value = { regex: q.regex, caseSensitive: q.caseSensitive, word: q.word }
  text.value = q.q
}

defineExpose({ focus: () => input.value?.select() ?? input.value?.focus(), seed })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1">
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
          <li v-for="row in shown" :key="row.kind === 'file' ? `f:${row.path}` : `m:${row.index}`" :style="{ height: `${ROW_H}px` }">
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
              class="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner pr-1 pl-6 text-left font-mono text-2xs hover:bg-fill"
              :title="`${row.path}:${row.line}`"
              @click="emit('open', abs(row.path), false, row.line)"
              @dblclick="emit('open', abs(row.path), true, row.line)"
            >
              <span class="w-8 shrink-0 text-right text-ink-faint tabular">{{ row.line }}</span>
              <span class="min-w-0 flex-1 truncate whitespace-pre text-ink-muted"
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
