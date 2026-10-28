<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, LoaderCircle } from 'lucide-vue-next'
import { CHILD_PAGE, flattenTree, parseTree, pathsToDepth, ROW_LIMIT, type TreeFormat, type TreeRow } from '../../lib/jsonTree'

const props = defineProps<{ text: string; format: TreeFormat; name: string }>()
const emit = defineEmits<{ failed: [message: string] }>()
const { t } = useI18n()

const EXPAND_ALL_DEPTH = 64
const root = shallowRef<unknown>(undefined)
const parsing = ref(true)
const expanded = shallowRef<Set<string>>(new Set(['']))
const shown = shallowRef<Map<string, number>>(new Map())
const filter = ref('')
const copied = ref<string | null>(null)
let parseSeq = 0
let copiedTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => [props.text, props.format] as const,
  async ([text, format], old) => {
    const seq = ++parseSeq
    parsing.value = true
    const res = await parseTree(text, format)
    if (seq !== parseSeq) return
    parsing.value = false
    if (!res.ok) {
      root.value = undefined
      emit('failed', res.error)
      return
    }
    root.value = res.value
    // A reload of the same file keeps what was open; a new file starts with the first level open.
    if (!old) expanded.value = pathsToDepth(res.value, 1, 200)
  },
  { immediate: true },
)

const flat = computed(() => (root.value === undefined ? { rows: [] as TreeRow[], truncated: false } : flattenTree(root.value, { expanded: expanded.value, filter: filter.value, shown: shown.value })))

function toggle(r: TreeRow): void {
  if (!r.size || r.kind === 'more') return
  const next = new Set(expanded.value)
  if (r.expanded) next.delete(r.path)
  else next.add(r.path)
  expanded.value = next
}

function showMore(r: TreeRow): void {
  const parent = r.path.slice(0, -'#more'.length)
  const next = new Map(shown.value)
  next.set(parent, (next.get(parent) ?? CHILD_PAGE) + CHILD_PAGE * 5)
  shown.value = next
}

const expandAll = (): void => void (expanded.value = pathsToDepth(root.value, EXPAND_ALL_DEPTH))
const collapseAll = (): void => void (expanded.value = new Set(['']))

async function copyPath(r: TreeRow): Promise<void> {
  try {
    await navigator.clipboard.writeText(r.path)
    copied.value = r.path
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = null), 1200)
  } catch {
    // clipboard denied: nothing to show
  }
}

function onRowKey(e: KeyboardEvent, r: TreeRow): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (r.kind === 'more') showMore(r)
    else toggle(r)
  } else if (e.key === 'ArrowRight' && r.size && !r.expanded) {
    e.preventDefault()
    toggle(r)
  } else if (e.key === 'ArrowLeft' && r.expanded) {
    e.preventDefault()
    toggle(r)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const sib = (e.key === 'ArrowDown' ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null
    sib?.focus()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && r.kind !== 'more') {
    e.preventDefault()
    void copyPath(r)
  }
}

const keyText = (r: TreeRow): string => (r.key === null ? (props.format === 'yaml' ? 'yaml' : 'json') : typeof r.key === 'number' ? String(r.key) : r.key)
</script>

<template>
  <div class="flex size-full min-h-0 flex-col" data-json-tree>
    <div class="flex h-8 shrink-0 items-center gap-1 border-b border-well-line px-2">
      <input
        v-model="filter"
        type="search"
        class="ccm-field h-6 min-w-0 flex-1"
        :placeholder="t('workspace.tree.filter')"
        :aria-label="t('workspace.tree.filter')"
        spellcheck="false"
        data-json-tree-filter
      />
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.tree.expandAll')" :aria-label="t('workspace.tree.expandAll')" :disabled="parsing" @click="expandAll">
        <ChevronsUpDown :size="14" aria-hidden="true" />
      </button>
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.tree.collapseAll')" :aria-label="t('workspace.tree.collapseAll')" :disabled="parsing" @click="collapseAll">
        <ChevronsDownUp :size="14" aria-hidden="true" />
      </button>
    </div>
    <div v-if="parsing" class="flex flex-1 items-center justify-center gap-1.5 text-xs text-well-ink" role="status">
      <LoaderCircle :size="13" class="animate-spin" aria-hidden="true" />{{ t('workspace.tree.parsing') }}
    </div>
    <div v-else class="ccm-scroll min-h-0 flex-1 overflow-auto tree-body py-1 font-mono" data-code-zoom>
      <ul role="tree" :aria-label="t('workspace.tree.label', { name })">
        <li
          v-for="r in flat.rows"
          :key="r.path"
          :role="r.kind === 'more' ? 'none' : 'treeitem'"
          :aria-expanded="r.size && r.kind !== 'more' ? r.expanded : undefined"
          :aria-level="r.depth + 1"
          tabindex="0"
          class="group flex min-h-6 cursor-default items-center gap-1 pr-2 whitespace-nowrap outline-none hover:bg-fill focus-visible:bg-fill"
          :style="{ paddingLeft: `${8 + r.depth * 16}px` }"
          :data-tree-path="r.path"
          @click="r.kind === 'more' ? showMore(r) : toggle(r)"
          @keydown="onRowKey($event, r)"
        >
          <template v-if="r.kind === 'more'">
            <span class="text-2xs text-accent-ink underline-offset-2 hover:underline">{{ t('workspace.tree.more', { n: r.size }) }}</span>
          </template>
          <template v-else>
            <ChevronRight v-if="r.size" :size="12" class="shrink-0 text-well-ink transition-transform" :class="r.expanded ? 'rotate-90' : ''" aria-hidden="true" />
            <span v-else class="w-3 shrink-0" aria-hidden="true" />
            <span class="shrink-0" :class="[typeof r.key === 'number' ? 'tk-index' : 'tk-key', r.hit ? 'rounded-inner bg-accent-soft text-accent-ink' : '']">{{ keyText(r) }}</span>
            <span class="shrink-0 text-well-ink" aria-hidden="true">:</span>
            <span class="min-w-0 truncate" :class="`tk-${r.kind}`" :title="r.size ? (r.kind === 'array' ? t('workspace.tree.items', r.size) : t('workspace.tree.keys', r.size)) : undefined">{{ r.preview }}</span>
            <button
              v-if="r.path"
              type="button"
              class="ccm-btn-plain ml-auto size-5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100"
              :title="copied === r.path ? t('workspace.tree.copied') : `${t('workspace.tree.copyPath')}: ${r.path}`"
              :aria-label="t('workspace.tree.copyPath')"
              tabindex="-1"
              data-tree-copy
              @click.stop="copyPath(r)"
            >
              <Check v-if="copied === r.path" :size="12" class="text-success" aria-hidden="true" />
              <Copy v-else :size="12" aria-hidden="true" />
            </button>
          </template>
        </li>
      </ul>
      <p v-if="filter && !flat.rows.some((r) => r.hit)" class="px-3 py-2 font-sans text-xs text-well-ink">{{ t('workspace.tree.noMatch') }}</p>
      <p v-if="flat.truncated" class="px-3 py-2 font-sans text-2xs text-well-ink">{{ t('workspace.tree.truncated', { n: ROW_LIMIT }) }}</p>
    </div>
  </div>
</template>

<style scoped>
.tree-body { font-size: var(--ccm-code-size, 13px); }
.tk-key { color: var(--ccm-syn-type); }
.tk-index { color: var(--ccm-syn-comment); }
.tk-string { color: var(--ccm-syn-string); }
.tk-number { color: var(--ccm-syn-number); }
.tk-boolean, .tk-null { color: var(--ccm-syn-keyword); }
.tk-object, .tk-array { color: var(--ccm-syn-comment); }
</style>
