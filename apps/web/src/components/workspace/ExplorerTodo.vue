<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, FileText, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { joinPath } from '../../lib/fileLinks'
import { searchFiles } from '../../lib/preview'
import { sameRange, uniformRange, type RowRange } from '../../lib/rowWindow'
import { fileCount, hitRuns, searchRows } from '../../lib/searchView'
import { onlyTag, tagCounts, TODO_QUERY, TODO_RE, TODO_TAGS, todoMatches, type TodoMatch, type TodoTag } from '../../lib/todoView'

const props = defineProps<{ root: string }>()
const emit = defineEmits<{ open: [path: string, keep: boolean, line: number] }>()

const { t } = useI18n()
const ROW_H = 22

const items = shallowRef<TodoMatch[]>([])
const truncated = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)
const scanned = ref(false)
const tag = ref<TodoTag | null>(null)
const collapsed = ref(new Set<string>())
let seq = 0

async function scan(): Promise<void> {
  const my = ++seq
  busy.value = true
  const res = await searchFiles(props.root, TODO_QUERY)
  if (my !== seq) return
  busy.value = false
  scanned.value = true
  if (!res.ok) {
    if (res.error === 'cancelled') return
    error.value = t(`workspace.search.error.${res.error}`, { detail: res.detail ?? '' })
    items.value = []
    truncated.value = false
    return
  }
  error.value = null
  items.value = todoMatches(res.matches)
  truncated.value = res.truncated
}

// Mounted only while the TODO view is shown: scanning here = scan when the tab opens.
watch(
  () => props.root,
  () => {
    collapsed.value = new Set()
    void scan()
  },
  { immediate: true },
)
onBeforeUnmount(() => seq++)

const counts = computed(() => tagCounts(items.value))
const shownItems = computed(() => onlyTag(items.value, tag.value))
const rows = computed(() => searchRows(shownItems.value, collapsed.value))
const files = computed(() => fileCount(shownItems.value))

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
const tagClass = (k: TodoTag): string => (k === 'TODO' ? 'text-accent-ink' : 'text-warning')
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1" data-explorer-todo>
    <div class="flex shrink-0 flex-wrap items-center gap-1 px-1" role="group" :aria-label="t('workspace.todo.filter')">
      <button
        type="button"
        class="h-6 cursor-pointer rounded-inner px-2 text-2xs text-ink-muted hover:bg-fill aria-pressed:bg-accent-soft aria-pressed:text-accent-ink"
        :aria-pressed="tag === null"
        data-todo-tag="all"
        @click="tag = null"
      >
        {{ t('workspace.todo.all') }} <span class="tabular">{{ items.length }}</span>
      </button>
      <button
        v-for="k in TODO_TAGS"
        :key="k"
        type="button"
        class="h-6 cursor-pointer rounded-inner px-2 font-mono text-2xs text-ink-muted hover:bg-fill disabled:cursor-default disabled:opacity-50 aria-pressed:bg-accent-soft aria-pressed:text-accent-ink"
        :aria-pressed="tag === k"
        :disabled="!counts[k]"
        :data-todo-tag="k"
        @click="tag = tag === k ? null : k"
      >
        {{ k }} <span class="font-sans tabular">{{ counts[k] }}</span>
      </button>
      <button type="button" class="ccm-btn-plain ms-auto size-6 justify-center p-0" :disabled="busy" :title="t('workspace.todo.refresh')" :aria-label="t('workspace.todo.refresh')" data-todo-refresh @click="scan">
        <RefreshCw :size="13" :class="busy ? 'ccm-spin' : ''" aria-hidden="true" />
      </button>
    </div>

    <p class="flex shrink-0 items-center gap-1 px-1 text-2xs text-ink-muted" role="status" aria-live="polite">
      <LoaderCircle v-if="busy && !scanned" :size="12" class="ccm-spin" aria-hidden="true" />
      <span v-if="error" class="text-st-error">{{ error }}</span>
      <template v-else-if="scanned">
        <span v-if="items.length">{{ t('workspace.todo.summary', { n: shownItems.length, files }, shownItems.length) }}</span>
        <span v-else>{{ t('workspace.todo.none') }}</span>
        <span v-if="truncated">· {{ t('workspace.search.truncated') }}</span>
      </template>
      <span v-else>{{ t('workspace.todo.scanning') }}</span>
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
              :data-todo-row="`${row.path}:${row.line}`"
              @click="emit('open', abs(row.path), false, row.line)"
              @dblclick="emit('open', abs(row.path), true, row.line)"
            >
              <span class="w-8 shrink-0 text-right text-ink-faint tabular">{{ row.line }}</span>
              <span class="min-w-0 flex-1 truncate whitespace-pre text-ink-muted"
                ><template v-for="(p, i) in hitRuns(row.text.trim(), TODO_RE)" :key="i"
                  ><span v-if="p.hit" class="font-semibold" :class="tagClass(p.text as TodoTag)">{{ p.text }}</span
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
