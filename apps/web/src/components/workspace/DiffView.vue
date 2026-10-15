<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { escapeHtml } from '../../lib/codeView'
import type { DiffFile, DiffLine } from '../../lib/diff'
import { foldRows, type Block } from '../../lib/diffBlocks'
import type { DiffHighlight } from '../../lib/diffOpts'
import { useDiffDecor } from '../../composables/useDiffDecor'
import { useWindowCopy } from '../../composables/useWindowCopy'
import { diffSideText } from '../../lib/windowCopy'
import { prefixOffsets, sameRange, spacer, windowRange, WINDOW_MIN_ROWS, type RowRange } from '../../lib/rowWindow'
import SplitDiff from './SplitDiff.vue'

const props = defineProps<{
  file: DiffFile
  blocks: Block[]
  layout: 'inline' | 'split'
  /** shiki grammar id, null = plain. */
  lang: string | null
  /** Fold unchanged runs farther than `context` lines from a change. */
  collapse: boolean
  context: number
  /** IntelliJ "Highlight": lines / words / split changes / characters / none. */
  highlight: DiffHighlight
  /** Split view: line changed blocks up with filler rows; scroll both sides together. */
  align?: boolean
  sync?: boolean
  /** Revert buttons shown; `revertBlocked` (a reason) keeps them visible but inert. */
  canRevert: boolean
  revertBlocked?: string | null
  current: number
  /** Split view column headers (default HEAD / working tree). */
  sides?: { left: string; right: string }
}>()
const emit = defineEmits<{ revert: [index: number]; focusBlock: [index: number] }>()

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const split = ref<InstanceType<typeof SplitDiff> | null>(null)
/** `${hunk}:${from}` of folds the user opened; reset per file. */
const expanded = ref<Set<string>>(new Set())
watch(
  () => props.file,
  () => (expanded.value = new Set()),
)

const { lineInfo, code: decorCode } = useDiffDecor({
  file: () => props.file,
  blocks: () => props.blocks,
  // SplitDiff tokenizes for itself; skip the work here while it is shown.
  lang: () => (props.layout === 'split' ? null : props.lang),
  highlight: () => props.highlight,
})
const code = (l: DiffLine | undefined): string => decorCode(l, l?.type === 'add' ? 'w-add' : 'w-del')

const SVG = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const UNDO = SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>')

const num = (n: number | undefined): string => (n === undefined ? '' : String(n))
const SIGN = { add: '+', del: '−', ctx: ' ', note: '' } as const

function revertButton(block: number, icon: string): string {
  if (!props.canRevert) return ''
  const label = props.revertBlocked ?? t('workspace.diff.revert')
  return `<button type="button" class="rv" data-revert="${block}"${props.revertBlocked ? ' aria-disabled="true"' : ''} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon}</button>`
}

function foldHtml(key: string, count: number, cols: string): string {
  const label = escapeHtml(t('workspace.diff.expand', { n: count }, count))
  return `<div class="fold ${cols}"><button type="button" data-fold="${key}">⋯ ${label}</button></div>`
}

/** Index of the first line of each block (where its revert button sits). */
const firstOf = computed(() => new Set(props.blocks.map((b) => props.file.hunks[b.hunk]!.lines[b.from])))

function rowHtml(l: DiffLine, i: number): string {
  if (l.type === 'note') {
    return `<div class="r note" data-i="${i}"><span class="n"></span><span class="n"></span><span class="a"></span><span class="s"></span><span class="c">${escapeHtml(l.text)}</span></div>`
  }
  const b = lineInfo.value.block.get(l)
  const attrs = `${b !== undefined ? ` data-block="${b}"` : ''}${l.new ? ` data-new="${l.new}"` : ''}`
  const act = b !== undefined && firstOf.value.has(l) ? revertButton(b, UNDO) : ''
  return `<div class="r ${l.type}" data-i="${i}"${attrs}><span class="n">${num(l.old)}</span><span class="n">${num(l.new)}</span><span class="a">${act}</span><span class="s">${SIGN[l.type]}</span><span class="c">${code(l)}
</span></div>`
}

type Item = { kind: 'gap' } | { kind: 'fold'; key: string; count: number } | { kind: 'row'; line: DiffLine }

/** Rendered items in order: hunk gaps, folds, rows. */
const items = computed<Item[]>(() => {
  if (props.layout === 'split') return []
  const out: Item[] = []
  props.file.hunks.forEach((h, hi) => {
    if (hi > 0) out.push({ kind: 'gap' })
    const changed = h.lines.map((l) => l.type === 'add' || l.type === 'del')
    const segments = props.collapse
      ? foldRows(changed, props.context, new Set([...expanded.value].filter((k) => k.startsWith(`${hi}:`)).map((k) => Number(k.slice(k.indexOf(':') + 1)))))
      : [{ kind: 'rows' as const, from: 0, to: changed.length }]
    for (const seg of segments) {
      if (seg.kind === 'fold') out.push({ kind: 'fold', key: `${hi}:${seg.from}`, count: seg.to - seg.from })
      else for (let i = seg.from; i < seg.to; i++) out.push({ kind: 'row', line: h.lines[i]! })
    }
  })
  return out
})

const itemHtml = (it: Item, i: number): string =>
  it.kind === 'gap' ? `<div class="gap" data-i="${i}" aria-hidden="true">⋯</div>` : it.kind === 'fold' ? foldHtml(it.key, it.count, `r" data-i="${i}`) : rowHtml(it.line, i)

// v45: long diffs render a window of items; heights per kind are measured (rows one height, folds / gaps their own).
const windowed = computed(() => items.value.length > WINDOW_MIN_ROWS)
const heights = ref({ row: 19, fold: 22, gap: 26 })
const range = shallowRef<RowRange>({ start: 0, end: 0 })
const offsets = computed(() => {
  if (!windowed.value) return null
  const list = items.value
  const h = heights.value
  return prefixOffsets(list.length, (i) => h[list[i]!.kind])
})
let scroller: HTMLElement | null = null
let frame = 0
const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => onScroll())

function scrollParent(): HTMLElement | null {
  for (let p = root.value?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/** Scroller offset of item 0 (the top spacer). */
function origin(): number {
  const first = root.value?.firstElementChild
  if (!first || !scroller) return 0
  return first.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

function measure(): void {
  const el = root.value
  if (!el) return
  const next = { ...heights.value }
  for (const kind of ['row', 'fold', 'gap'] as const) {
    const h = el.querySelector<HTMLElement>(kind === 'row' ? '.r' : `.${kind}`)?.getBoundingClientRect().height
    if (h) next[kind] = h
  }
  if (next.row !== heights.value.row || next.fold !== heights.value.fold || next.gap !== heights.value.gap) heights.value = next
}

function updateRange(): void {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  const offs = offsets.value
  if (!offs) return
  const top = scroller ? scroller.scrollTop - origin() : 0
  const next = windowRange(offs, top, scroller?.clientHeight || 1000)
  if (!sameRange(next, range.value)) range.value = next
}

const onScroll = (): void => {
  if (windowed.value && !frame) frame = requestAnimationFrame(updateRange)
}

watch(offsets, () => updateRange())

// The inline root comes and goes with the split layout: follow its scroll container.
watch(
  root,
  (el) => {
    scroller?.removeEventListener('scroll', onScroll)
    if (scroller) resize?.unobserve(scroller)
    scroller = el ? scrollParent() : null
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    if (scroller) resize?.observe(scroller)
    updateRange()
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  scroller?.removeEventListener('scroll', onScroll)
  resize?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})

const html = computed(() => {
  if (props.layout === 'split') return ''
  const list = items.value
  const offs = offsets.value
  if (!offs) return list.map(itemHtml).join('')
  const { start, end } = range.value
  let out = spacer(offs[start]!)
  for (let i = start; i < end; i++) out += itemHtml(list[i]!, i)
  return out + spacer(offs[list.length]! - offs[end]!)
})

const windowCopy = useWindowCopy({
  container: () => root.value,
  scope: () => scroller,
  enabled: () => windowed.value && props.layout !== 'split',
  rowText: (i) => {
    const it = items.value[i]
    return it?.kind === 'row' && it.line.type !== 'note' ? it.line.text : null
  },
  // Inline mixes both sides; "all" is the new file (the old one for a deletion).
  allText: () => diffSideText(props.file, hasNew.value ? 'new' : 'old'),
})
const hasNew = computed(() => props.file.hunks.some((h) => h.lines.some((l) => l.type === 'add' || l.type === 'ctx')))
const allSelected = windowCopy.allSelected
watch(html, () => windowCopy.capture(), { flush: 'pre' })
watch(html, () => windowCopy.restore(), { flush: 'post' })

function markCurrent(): void {
  const el = root.value
  if (!el) return
  for (const r of el.querySelectorAll('.is-current')) r.classList.remove('is-current')
  for (const r of el.querySelectorAll(`[data-block="${props.current}"]`)) r.classList.add('is-current')
}

watch(
  [html, () => props.current],
  () =>
    void nextTick(() => {
      if (windowed.value) measure()
      markCurrent()
    }),
  { flush: 'post' },
)

function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  const fold = target?.closest<HTMLElement>('[data-fold]')
  if (fold) {
    expanded.value = new Set([...expanded.value, fold.dataset.fold!])
    return
  }
  const rv = target?.closest<HTMLElement>('[data-revert]')
  if (rv) {
    const i = Number(rv.dataset.revert)
    emit('focusBlock', i)
    if (rv.getAttribute('aria-disabled') !== 'true') emit('revert', i)
    return
  }
  const row = target?.closest<HTMLElement>('[data-block]')
  if (row) emit('focusBlock', Number(row.dataset.block))
}

async function scrollToBlock(i: number): Promise<void> {
  if (props.layout === 'split') return split.value?.scrollToBlock(i)
  // A stale caret would win over the change F7 just moved to (sourceLine).
  const sel = window.getSelection()
  if (sel?.rangeCount && root.value?.contains(sel.focusNode)) sel.removeAllRanges()
  const offs = offsets.value
  if (offs && scroller) {
    const at = items.value.findIndex((it) => it.kind === 'row' && lineInfo.value.block.get(it.line) === i)
    if (at >= 0) {
      scroller.scrollTop = origin() + offs[at]! - scroller.clientHeight / 2
      updateRange()
    }
  }
  await nextTick()
  markCurrent()
  root.value?.querySelector<HTMLElement>(`[data-block="${i}"]`)?.scrollIntoView({ block: 'center' })
}

/** New-side line (1-based) at the top of block `i`, for F4. */
function lineOf(i: number): number | undefined {
  const b = props.blocks[i]
  return b ? Math.max(1, b.line1 + 1) : undefined
}

/** New-side line of an inline row, the change it belongs to, or the next numbered row. */
function rowLine(row: Element | null | undefined): number | undefined {
  for (let r = row, k = 0; r && k < 500; r = r.nextElementSibling, k++) {
    const h = r as HTMLElement
    if (h.dataset.new) return Number(h.dataset.new)
    if (h.dataset.block) return lineOf(Number(h.dataset.block))
  }
  return undefined
}

/** First row (binary search on the rendered rows) whose bottom is below `y`. */
function rowAt(y: number): Element | undefined {
  const rows = root.value?.children
  if (!rows?.length) return undefined
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid]!.getBoundingClientRect().bottom <= y) lo = mid + 1
    else hi = mid
  }
  return rows[lo]
}

/**
 * F4 target (IntelliJ keeps the caret): the caret / selection inside the diff, else the current change while it is on
 * screen, else the first line at the top of the visible area.
 */
function sourceLine(): number | undefined {
  if (props.layout === 'split') return split.value?.sourceLine()
  const el = root.value
  if (!el) return undefined
  const sel = window.getSelection()
  const node = sel?.rangeCount ? sel.focusNode : null
  if (node && el.contains(node)) {
    const row = (node instanceof Element ? node : node.parentElement)?.closest('.r, .fold, .gap')
    if (row) return rowLine(row)
  }
  const view = (el.parentElement ?? el).getBoundingClientRect()
  const cur = el.querySelectorAll(`[data-block="${props.current}"]`)
  if (cur.length) {
    const a = cur[0]!.getBoundingClientRect()
    const b = cur[cur.length - 1]!.getBoundingClientRect()
    if (b.bottom > view.top && a.top < view.bottom) return lineOf(props.current)
  }
  return rowLine(rowAt(view.top + 1))
}

defineExpose({ scrollToBlock, lineOf, sourceLine, switchSide: () => split.value?.switchSide() })
</script>

<template>
  <SplitDiff
    v-if="layout === 'split'"
    ref="split"
    :file="file"
    :blocks="blocks"
    :lang="lang"
    :collapse="collapse"
    :context="context"
    :highlight="highlight"
    :can-revert="canRevert"
    :revert-blocked="revertBlocked"
    :current="current"
    :sides="sides ?? { left: 'HEAD', right: t('workspace.diff.side.working') }"
    :align="align ?? false"
    :sync="sync ?? true"
    @revert="(i) => emit('revert', i)"
    @focus-block="(i) => emit('focusBlock', i)"
  />
  <div
    v-else
    ref="root"
    class="diff ccm-code w-max min-w-full py-1"
    :class="{ 'hl-none': highlight === 'none', 'is-all': allSelected, 'all-old': allSelected && !hasNew }"
    role="document"
    data-code-zoom
    :aria-label="blocks.length ? t('workspace.diff.change', { n: current + 1, total: blocks.length }) : undefined"
    @click="onClick"
    v-html="html"
  />
</template>

<style scoped>
/* On the well: diff tints use the well diff inks; shiki colours come from .ccm-code (style.css). */
.diff {
  --add-ink: var(--ccm-diff-add-well);
  --del-ink: var(--ccm-diff-del-well);
  --add-bg: color-mix(in srgb, var(--add-ink) 14%, transparent);
  --del-bg: color-mix(in srgb, var(--del-ink) 16%, transparent);
  --add-word: color-mix(in srgb, var(--add-ink) 34%, transparent);
  --del-word: color-mix(in srgb, var(--del-ink) 38%, transparent);
  color: var(--shiki-foreground);
  font-family: var(--font-mono);
  font-size: calc(var(--ccm-code-size, 13px) - 0.5px);
  font-variant-ligatures: none;
  line-height: 1.5;
  tab-size: 4;
}
.diff :deep(.r) {
  display: grid;
  grid-template-columns: max-content max-content 1.5em 1.25em minmax(0, 1fr);
}
.diff :deep(.n) {
  min-width: 3.25em;
  padding-inline: 0.5em;
  text-align: right;
  color: color-mix(in srgb, var(--ccm-well-ink) 50%, var(--ccm-well));
  user-select: none;
  font-variant-numeric: tabular-nums;
}
.diff :deep(.s) {
  user-select: none;
  text-align: center;
}
.diff :deep(.a) {
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
.diff :deep(.c) {
  padding-right: 1.5em;
  white-space: pre;
}
.diff :deep(.r.add) {
  background: var(--add-bg);
}
.diff :deep(.r.del) {
  background: var(--del-bg);
}
.diff :deep(.r.add .s) {
  color: var(--add-ink);
}
.diff :deep(.r.del .s) {
  color: var(--del-ink);
}
.diff :deep(.r.note .c) {
  font-style: italic;
  color: var(--ccm-syn-comment, #7f8c98);
}
/* Highlight "None": no row tint; the sign and number columns still show the change. */
.diff.hl-none :deep(.r.add),
.diff.hl-none :deep(.r.del) {
  background: transparent;
}
.diff.hl-none :deep(.r.add > .n) {
  background: var(--add-bg);
}
.diff.hl-none :deep(.r.del > .n) {
  background: var(--del-bg);
}
.diff :deep(mark.w-add) {
  color: inherit;
  border-radius: 2px;
  background: var(--add-word);
}
.diff :deep(mark.w-del) {
  color: inherit;
  border-radius: 2px;
  background: var(--del-word);
}
/* Current change: a focus bar on the number column, like the hunk head before. */
.diff :deep(.is-current > .n:first-child) {
  box-shadow: inset 2px 0 0 var(--ccm-focus);
}
.diff :deep(.rv) {
  display: inline-grid;
  place-items: center;
  width: 1.35em;
  height: 1.35em;
  border-radius: 4px;
  color: var(--ccm-well-ink);
  cursor: pointer;
}
.diff :deep(.rv:hover:not([aria-disabled='true'])) {
  background: var(--ccm-well-line);
  color: var(--del-ink);
}
.diff :deep(.rv[aria-disabled='true']) {
  cursor: not-allowed;
  color: color-mix(in srgb, var(--ccm-well-ink) 40%, var(--ccm-well));
}
.diff :deep(.rv:focus-visible),
.diff :deep(.fold button:focus-visible) {
  outline: 2px solid var(--ccm-focus);
  outline-offset: -1px;
}
.diff :deep(.fold) {
  display: block;
  border-block: 1px dashed var(--ccm-well-line);
  background: color-mix(in srgb, var(--ccm-well-ink) 4%, var(--ccm-well));
}
.diff :deep(.fold button) {
  width: 100%;
  padding: 0.1em 0 0.1em 7.5em;
  text-align: left;
  font-size: calc(var(--ccm-code-size, 13px) - 1.5px);
  color: var(--ccm-syn-comment, #7f8c98);
  cursor: pointer;
}
.diff :deep(.fold button:hover) {
  color: var(--ccm-well-ink);
  background: var(--ccm-well-line);
}
.diff :deep(.gap) {
  padding: 0.25em 0 0.25em 7.5em;
  color: var(--ccm-syn-comment, #7f8c98);
  border-block: 1px solid var(--ccm-well-line);
  user-select: none;
}
.diff ::selection,
.diff :deep(*)::selection {
  background: var(--ccm-well-selection, #3f638b);
}
/* Windowed Ctrl/⌘+A (see FilePane): "all" is painted on the text rows. */
.diff.is-all :deep(.r:not(.del):not(.note) .c),
.diff.all-old :deep(.r.del .c) {
  background: var(--ccm-well-selection, #3f638b);
}
</style>
