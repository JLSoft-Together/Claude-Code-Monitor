<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitMerge, Tag } from 'lucide-vue-next'
import type { LogCommit } from '@ccm/shared'
import { graphWidth, type GraphRow } from '../../../lib/commitGraph'
import { labelText, parseDecorations } from '../../../lib/gitRefs'
import { isMac } from '../../../lib/platform'
import LogGraphCell from './LogGraphCell.vue'

const props = defineProps<{
  commits: LogCommit[]
  rows: GraphRow[]
  selected: string | null
  headHash: string | null
  remotes: string[]
  loading: boolean
  loadingMore: boolean
  more: boolean
  /** Why the list is empty: none = it is not, filtered = no match, repo = no commits yet. */
  empty: 'none' | 'filtered' | 'repo'
  /** The page query failed: the filters stay usable, this area explains and offers a way out. */
  error?: string | null
  /** Any filter is set (the error then offers to clear them). */
  filtered?: boolean
}>()
const emit = defineEmits<{ select: [hash: string]; open: [hash: string]; loadMore: []; menu: [hash: string, x: number, y: number]; clear: []; retry: [] }>()
const { t, locale } = useI18n()

const ROW_H = 24
const OVERSCAN = 12
const scroller = ref<HTMLElement | null>(null)
const top = ref(0)
const height = ref(400)
const copied = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const lanes = computed(() => graphWidth(props.rows))
const first = computed(() => Math.max(0, Math.floor(top.value / ROW_H) - OVERSCAN))
const last = computed(() => Math.min(props.commits.length, Math.ceil((top.value + height.value) / ROW_H) + OVERSCAN))
const visible = computed(() => props.commits.slice(first.value, last.value).map((c, i) => ({ c, row: props.rows[first.value + i], index: first.value + i })))
const activeId = computed(() => (props.selected && visible.value.some((v) => v.c.hash === props.selected) ? `log-${props.selected}` : undefined))
const selectedIndex = computed(() => props.commits.findIndex((c) => c.hash === props.selected))

const dateFmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }))
const fullFmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'full', timeStyle: 'medium' }))
const labelsOf = (c: LogCommit) => parseDecorations(c.refs, props.remotes)

function checkMore(): void {
  const el = scroller.value
  if (el && props.more && !props.loadingMore && el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 40) emit('loadMore')
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  top.value = el.scrollTop
  checkMore()
}

const resize = new ResizeObserver(([e]) => {
  height.value = e?.contentRect.height ?? height.value
  checkMore()
})
watch(
  scroller,
  (el, old) => {
    if (old) resize.unobserve(old)
    if (el) {
      resize.observe(el)
      top.value = el.scrollTop
      height.value = el.clientHeight
    }
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  resize.disconnect()
  clearTimeout(copiedTimer)
})

function scrollToIndex(i: number): void {
  const el = scroller.value
  if (!el || i < 0) return
  const y = i * ROW_H
  if (y < el.scrollTop) el.scrollTop = y
  else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight
}

watch(
  () => [props.commits.length, props.more, props.loadingMore],
  () => void nextTick(checkMore),
)

watch(
  () => props.selected,
  () => void nextTick(() => scrollToIndex(selectedIndex.value)),
)

function move(to: number): void {
  const c = props.commits[Math.max(0, Math.min(props.commits.length - 1, to))]
  if (c) emit('select', c.hash)
}

async function copyHash(hash: string): Promise<void> {
  await navigator.clipboard.writeText(hash).catch(() => undefined)
  copied.value = hash.slice(0, 8)
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = null), 1500)
}

function onKey(e: KeyboardEvent): void {
  const page = Math.max(1, Math.floor(height.value / ROW_H) - 1)
  const at = selectedIndex.value
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mod && e.key.toLowerCase() === 'c' && props.selected) {
    e.preventDefault()
    void copyHash(props.selected)
    return
  }
  const map: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, PageDown: at + page, PageUp: at - page, Home: 0, End: props.commits.length - 1 }
  if (e.key in map) {
    e.preventDefault()
    move(map[e.key]!)
  } else if (e.key === 'Enter' && props.selected) {
    e.preventDefault()
    emit('open', props.selected)
  }
}

defineExpose({ focus: () => scroller.value?.focus() })
</script>

<template>
  <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div v-if="loading && !commits.length" class="grid flex-1 place-items-center text-xs text-ink-muted">…</div>
    <div v-else-if="error" class="grid flex-1 place-items-center p-6 text-center" role="alert" data-log-error>
      <div class="flex max-w-sm flex-col items-center gap-2">
        <p class="text-sm text-ink-muted">{{ t(`workspace.log.error.${error}`) }}</p>
        <p v-if="filtered" class="text-xs text-ink-faint">{{ t('workspace.log.table.errorHint') }}</p>
        <div class="flex flex-wrap items-center justify-center gap-2">
          <button v-if="filtered" type="button" class="ccm-btn" data-log-error-clear @click="emit('clear')">{{ t('workspace.log.filter.clear') }}</button>
          <button type="button" class="ccm-btn" data-log-error-retry @click="emit('retry')">{{ t('workspace.log.table.retry') }}</button>
        </div>
      </div>
    </div>
    <div v-else-if="empty !== 'none'" class="grid flex-1 place-items-center p-6 text-center">
      <div class="flex flex-col items-center gap-2">
        <p class="text-sm text-ink-muted">{{ t(empty === 'repo' ? 'workspace.log.table.emptyRepo' : 'workspace.log.table.empty') }}</p>
        <button v-if="empty === 'filtered'" type="button" class="ccm-btn" @click="emit('clear')">{{ t('workspace.log.filter.clear') }}</button>
      </div>
    </div>
    <div
      v-else
      ref="scroller"
      class="ccm-scroll @container min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
      role="listbox"
      tabindex="0"
      :aria-label="t('workspace.log.table.label')"
      :aria-activedescendant="activeId"
      data-log-table
      @scroll.passive="onScroll"
      @keydown="onKey"
    >
      <div class="relative" :style="{ height: `${commits.length * ROW_H}px` }">
        <div
          v-for="v in visible"
          :id="`log-${v.c.hash}`"
          :key="v.c.hash"
          role="option"
          :aria-selected="v.c.hash === selected"
          :aria-setsize="commits.length"
          :aria-posinset="v.index + 1"
          class="absolute inset-x-0 flex h-6 min-w-0 cursor-default items-center gap-2 pr-2 text-xs"
          :class="v.c.hash === selected ? 'bg-selection text-ink' : 'text-ink hover:bg-fill'"
          :title="`${v.c.author} <${v.c.email}> · ${fullFmt.format(v.c.time * 1000)}`"
          :style="{ top: `${v.index * ROW_H}px` }"
          :data-commit="v.c.hash"
          @click="emit('select', v.c.hash)"
          @dblclick="emit('open', v.c.hash)"
          @contextmenu.prevent="emit('select', v.c.hash), emit('menu', v.c.hash, $event.clientX, $event.clientY)"
        >
          <LogGraphCell v-if="v.row" :row="v.row" :lanes="lanes" :head="v.c.hash === headHash" />
          <span class="flex min-w-28 flex-1 items-center gap-1.5 overflow-hidden" :class="v.c.hash === headHash ? 'font-semibold' : ''">
            <GitMerge v-if="v.c.parents.length > 1" :size="12" class="shrink-0 text-ink-faint" :aria-label="t('workspace.log.table.merge')" />
            <span
              v-for="l in labelsOf(v.c)"
              :key="`${l.kind}:${l.name}`"
              class="inline-flex max-w-24 min-w-0 shrink items-center gap-0.5 overflow-hidden rounded-inner px-1 text-2xs leading-4"
              :class="l.kind === 'tag' ? 'bg-warning-soft text-warning' : l.kind === 'remote' ? 'bg-fill text-ink-muted' : 'bg-accent-soft text-accent-ink'"
              :title="labelText(l)"
              data-ref-pill
            >
              <Tag v-if="l.kind === 'tag'" :size="10" class="shrink-0" aria-hidden="true" />
              <span class="truncate">{{ l.kind === 'head' ? t('workspace.log.table.head') : labelText(l) }}</span>
            </span>
            <span class="min-w-0 truncate" :title="v.c.subject" data-log-subject>{{ v.c.subject }}</span>
          </span>
          <span class="hidden w-32 min-w-0 shrink truncate text-ink-muted @[24rem]:block" :title="`${v.c.author} <${v.c.email}>`">{{ v.c.author }}</span>
          <span class="hidden w-32 min-w-0 shrink truncate text-right text-ink-muted tabular @[34rem]:block" :title="fullFmt.format(v.c.time * 1000)">{{ dateFmt.format(v.c.time * 1000) }}</span>
        </div>
      </div>
      <p v-if="loadingMore" class="py-1 text-center text-2xs text-ink-faint">{{ t('workspace.log.table.loadingMore') }}</p>
    </div>
    <p v-if="copied" class="pointer-events-none absolute right-2 bottom-2 rounded-inner bg-surface px-2 py-1 text-2xs text-ink shadow" role="status">{{ t('workspace.log.table.copied', { hash: copied }) }}</p>
  </div>
</template>
