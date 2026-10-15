<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronsRight } from 'lucide-vue-next'
import { escapeHtml } from '../../lib/codeView'
import { isMac } from '../../lib/platform'
import type { DiffFile } from '../../lib/diff'
import type { Block } from '../../lib/diffBlocks'
import type { DiffHighlight } from '../../lib/diffOpts'
import { connectorPath, mapRow, midRow, scrollTopFor, splitModel, visibleFragments, type Fragment, type Side, type SplitRow } from '../../lib/splitDiff'
import { useDiffDecor } from '../../composables/useDiffDecor'
import { useWindowCopy } from '../../composables/useWindowCopy'
import { diffSideText } from '../../lib/windowCopy'
import { maxColumns, spacer, uniformRange, WINDOW_MIN_ROWS } from '../../lib/rowWindow'

const props = defineProps<{
  file: DiffFile
  blocks: Block[]
  lang: string | null
  collapse: boolean
  context: number
  highlight: DiffHighlight
  canRevert: boolean
  revertBlocked?: string | null
  current: number
  sides: { left: string; right: string }
  align: boolean
  sync: boolean
}>()
const emit = defineEmits<{ revert: [index: number]; focusBlock: [index: number] }>()

const { t } = useI18n()
const GUTTER_W = 44
const BUTTON = 18

const { code } = useDiffDecor({ file: () => props.file, blocks: () => props.blocks, lang: () => props.lang, highlight: () => props.highlight })
const root = ref<HTMLElement | null>(null)
const leftEl = ref<HTMLElement | null>(null)
const rightEl = ref<HTMLElement | null>(null)
const leftBody = ref<HTMLElement | null>(null)
const rightBody = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)
/** Row height in px: rows are 1.5em of the code font, measured so zoom and font changes stay exact. */
const lh = ref(19.5)
const viewH = ref(0)
const top = reactive({ left: 0, right: 0 })
/** `${hunk}:${unit}` of folds the user opened; reset per file. */
const expanded = ref<Set<string>>(new Set())
/** Side the caret was last in: F4 reads its top line, Ctrl+Shift+Tab leaves it. */
let lastSide: Side = 'right'

const model = computed(() => splitModel(props.file, props.blocks, { collapse: props.collapse, context: props.context, expanded: expanded.value, align: props.align }))
const shown = computed(() => visibleFragments(model.value.frags, lh.value, top.left, top.right, viewH.value))
const el = (side: Side): HTMLElement | null => (side === 'left' ? leftEl.value : rightEl.value)
const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')

const num = (n: number | undefined): string => (n === undefined ? '' : String(n))

function rowHtml(r: SplitRow, side: Side, i: number): string {
  const at = ` data-i="${i}"`
  if (r.kind === 'gap') return `<div class="sd-row gap"${at} aria-hidden="true"><span class="n"></span><span class="c">⋯</span></div>`
  if (r.kind === 'fold') {
    const label = escapeHtml(t('workspace.diff.expand', { n: r.count }, r.count))
    return `<div class="sd-row fold"${at}><span class="n"></span><button type="button" class="c" data-fold="${r.key}">⋯ ${label}</button></div>`
  }
  if (r.kind === 'note') return `<div class="sd-row note"${at}><span class="n"></span><span class="c">${escapeHtml(r.text)}</span></div>`
  if (r.kind === 'pad') return `<div class="sd-row pad ${props.blocks[r.block]!.type}"${at} data-block="${r.block}" aria-hidden="true"><span class="n"></span><span class="c"></span></div>`
  const l = r.line
  const n = num(side === 'left' ? l.old : l.new)
  // Unchanged rows carry the new-side number on both sides (F4 from the left side).
  const newAttr = l.new ? ` data-new="${l.new}"` : ''
  if (r.block === null) return `<div class="sd-row"${at}${newAttr}><span class="n">${n}</span><span class="c">${code(l, 'w-mod')}\n</span></div>`
  const type = props.blocks[r.block]!.type
  const kind = escapeHtml(t(`workspace.gutter.kind.${type}`))
  const words = type === 'deleted' ? 'w-del' : type === 'added' ? 'w-add' : 'w-mod'
  return `<div class="sd-row ${type}"${at} data-block="${r.block}"${newAttr}><span class="n" title="${kind}">${n}</span><span class="c">${code(l, words)}\n</span></div>`
}

// v45: past WINDOW_MIN_ROWS each side renders only rows near its scroll position (rows are all `lh` high).
const windowed = computed(() => Math.max(model.value.left.length, model.value.right.length) > WINDOW_MIN_ROWS)
/** "start:end" (a string, so the side's HTML recomputes only when the window really moves). */
function windowKey(side: Side): string {
  const n = (side === 'left' ? model.value.left : model.value.right).length
  if (!windowed.value) return `0:${n}`
  const r = uniformRange(n, lh.value, side === 'left' ? top.left : top.right, viewH.value || 1000)
  return `${r.start}:${r.end}`
}
const leftKey = computed(() => windowKey('left'))
const rightKey = computed(() => windowKey('right'))
const bodyWidth = computed(() => {
  if (!windowed.value) return undefined
  const cols = (rows: SplitRow[]) => maxColumns(rows.flatMap((r) => (r.kind === 'line' ? [r.line.text] : [])))
  return `calc(${Math.max(cols(model.value.left), cols(model.value.right))}ch + 5em)`
})

/** Rows, then a thin line where a fragment has no rows on this side (Inserted on the left, Deleted on the right). */
function sideHtml(side: Side, key: string): string {
  const rows = side === 'left' ? model.value.left : model.value.right
  const [start, end] = key.split(':').map(Number) as [number, number]
  let out = windowed.value ? spacer(start * lh.value) : ''
  for (let i = start; i < end; i++) out += rowHtml(rows[i]!, side, i)
  if (windowed.value) out += spacer((rows.length - end) * lh.value)
  for (const f of model.value.frags) {
    const at = side === 'left' ? f.l1Start : f.l2Start
    const empty = side === 'left' ? f.l1Start === f.l1End : f.l2Start === f.l2End
    if (empty) out += `<div class="sd-mark ${f.type}" data-block="${f.block}" style="top: calc(${at} * 1.5em)" aria-hidden="true"></div>`
  }
  return out
}

const leftHtml = computed(() => sideHtml('left', leftKey.value))
const rightHtml = computed(() => sideHtml('right', rightKey.value))

function sideCopy(side: Side) {
  const copy = useWindowCopy({
    container: () => (side === 'left' ? leftBody.value : rightBody.value),
    scope: () => el(side),
    enabled: () => windowed.value,
    rowText: (i) => {
      const r = (side === 'left' ? model.value.left : model.value.right)[i]
      return r?.kind === 'line' ? r.line.text : null
    },
    allText: () => diffSideText(props.file, side === 'left' ? 'old' : 'new'),
  })
  const html = side === 'left' ? leftHtml : rightHtml
  watch(html, () => copy.capture(), { flush: 'pre' })
  watch(html, () => copy.restore(), { flush: 'post' })
  return copy.allSelected
}
const leftAll = sideCopy('left')
const rightAll = sideCopy('right')

let frame = 0
/** Gutter redraw: one rAF per burst of scroll events. */
function schedule(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    top.left = leftEl.value?.scrollTop ?? 0
    top.right = rightEl.value?.scrollTop ?? 0
  })
}

/** Side whose scroll we set ourselves; its next scroll event is not synced back (cleared the frame after). */
let syncing: Side | null = null

function onScroll(side: Side): void {
  schedule()
  if (!props.sync || syncing === side) return
  const src = el(side)
  const dst = el(other(side))
  if (!src || !dst) return
  const want = scrollTopFor(mapRow(midRow(src.scrollTop, src.clientHeight, lh.value), model.value.frags, side), lh.value, dst.clientHeight)
  if (Math.abs(dst.scrollTop - want) < 0.5 && dst.scrollLeft === src.scrollLeft) return
  const target = other(side)
  syncing = target
  dst.scrollTop = want
  dst.scrollLeft = src.scrollLeft
  requestAnimationFrame(() => {
    if (syncing === target) syncing = null
  })
}

let ro: ResizeObserver | null = null
function measure(): void {
  const h = probe.value?.getBoundingClientRect().height
  if (h) lh.value = h
  viewH.value = leftEl.value?.clientHeight ?? 0
  schedule()
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure)
    if (probe.value) ro.observe(probe.value)
    if (leftEl.value) ro.observe(leftEl.value)
  }
  measure()
})
onBeforeUnmount(() => {
  ro?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})

// Keyed on path + sides, not the object: a refresh of the same diff (watcher, keepPosition) must not jump to the top.
watch(
  () => [props.file.path, props.sides.left, props.sides.right].join('\0'),
  () => {
    expanded.value = new Set()
    for (const p of [leftEl.value, rightEl.value]) if (p) p.scrollTop = p.scrollLeft = 0
    schedule()
  },
)

function markCurrent(): void {
  const r = root.value
  if (!r) return
  // Only the v-html rows / marks: the connector paths' is-current is a Vue class binding it would not re-add.
  for (const x of r.querySelectorAll('[data-block].is-current')) x.classList.remove('is-current')
  for (const x of r.querySelectorAll(`[data-block="${props.current}"]`)) x.classList.add('is-current')
}
watch([leftHtml, rightHtml, () => props.current], () => void nextTick(markCurrent), { flush: 'post' })
watch(model, () => schedule())

function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  const fold = target?.closest<HTMLElement>('[data-fold]')
  if (fold) {
    expanded.value = new Set([...expanded.value, fold.dataset.fold!])
    return
  }
  const row = target?.closest<HTMLElement>('[data-block]')
  if (row) emit('focusBlock', Number(row.dataset.block))
}

function revert(i: number): void {
  emit('focusBlock', i)
  if (!props.revertBlocked) emit('revert', i)
}

/** `»` sits at the top of the left rows of its fragment, kept inside the gutter. */
const revertTop = (f: Fragment): number => Math.max(0, Math.min(viewH.value - BUTTON, f.l1Start * lh.value - top.left + (lh.value - BUTTON) / 2))

function clearSelectionInside(): void {
  const sel = window.getSelection()
  if (sel?.rangeCount && root.value?.contains(sel.focusNode)) sel.removeAllRanges()
}

async function scrollToBlock(i: number): Promise<void> {
  clearSelectionInside()
  await nextTick()
  markCurrent()
  const f = model.value.frags.find((x) => x.block === i)
  if (!f) return
  const side: Side = f.l2End > f.l2Start ? 'right' : 'left'
  const pane = el(side)
  if (!pane) return
  pane.scrollTop = scrollTopFor(side === 'right' ? f.l2Start : f.l1Start, lh.value, pane.clientHeight)
  onScroll(side)
  if (!props.sync) {
    const o = el(other(side))
    if (o) o.scrollTop = scrollTopFor(side === 'right' ? f.l1Start : f.l2Start, lh.value, o.clientHeight)
  }
}

/** New-side line (1-based) of a row: its own number, the change it belongs to, or the next numbered row. */
function rowLine(row: Element | null | undefined): number | undefined {
  for (let r = row, k = 0; r && k < 500; r = r.nextElementSibling, k++) {
    const h = r as HTMLElement
    if (h.dataset.new) return Number(h.dataset.new)
    if (h.dataset.block) {
      const b = props.blocks[Number(h.dataset.block)]
      if (b) return Math.max(1, b.line1 + 1)
    }
  }
  return undefined
}

/**
 * F4 target (IntelliJ keeps the caret): the caret / selection inside the diff, else the current change while it is on
 * screen, else the top line of the side the caret was last in.
 */
function sourceLine(): number | undefined {
  const sel = window.getSelection()
  const node = sel?.rangeCount ? sel.focusNode : null
  if (node && root.value?.contains(node)) {
    const row = (node instanceof Element ? node : node.parentElement)?.closest('.sd-row')
    if (row) return rowLine(row)
  }
  const f = model.value.frags.find((x) => x.block === props.current)
  const l = leftEl.value
  const r = rightEl.value
  if (!l || !r) return undefined
  if (f && visibleFragments([f], lh.value, l.scrollTop, r.scrollTop, l.clientHeight).length) {
    return f.l2End > f.l2Start ? modelLine('right', f.l2Start) : modelLine('left', f.l1Start)
  }
  return modelLine(lastSide, Math.floor(el(lastSide)!.scrollTop / lh.value + 0.5))
}

/** `rowLine` on the model (rows may be outside the rendered window). */
function modelLine(side: Side, from: number): number | undefined {
  const rows = side === 'left' ? model.value.left : model.value.right
  for (let i = Math.max(0, from), k = 0; i < rows.length && k < 500; i++, k++) {
    const r = rows[i]!
    if (r.kind === 'line' && r.line.new) return r.line.new
    const block = r.kind === 'line' || r.kind === 'pad' ? r.block : null
    if (block !== null) {
      const b = props.blocks[block]
      if (b) return Math.max(1, b.line1 + 1)
    }
  }
  return undefined
}

/** Ctrl+Shift+Tab (IntelliJ): caret to the other side. */
function switchSide(): void {
  const to = other(lastSide)
  lastSide = to
  el(to)?.focus()
}

function onPaneKey(e: KeyboardEvent): void {
  // Windows / Linux: Ctrl+Shift+Tab is the previous workspace tab (v18), taken in the capture phase before this pane.
  if (isMac && e.key === 'Tab' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    e.preventDefault()
    switchSide()
  }
}

defineExpose({ scrollToBlock, sourceLine, switchSide })
</script>

<template>
  <div
    ref="root"
    class="is-split ccm-code flex h-full min-h-0 min-w-0 flex-col"
    :class="{ 'hl-none': highlight === 'none' }"
    data-code-zoom
    data-split-diff
    :aria-label="blocks.length ? t('workspace.diff.change', { n: current + 1, total: blocks.length }) : undefined"
  >
    <div class="sd-heads flex shrink-0 border-b border-well-line">
      <span class="min-w-0 flex-1 truncate px-2" :title="sides.left" data-split-head="left">{{ sides.left }}</span>
      <span class="shrink-0" :style="{ width: `${GUTTER_W}px` }" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate px-2" :title="sides.right" data-split-head="right">{{ sides.right }}</span>
    </div>
    <div class="relative flex min-h-0 flex-1">
      <div ref="probe" class="sd-row sd-probe" aria-hidden="true"><span class="n">0</span><span class="c">0</span></div>
      <div ref="leftEl" class="sd-pane ccm-scroll" tabindex="0" role="document" data-side="left" :aria-label="sides.left" @scroll.passive="onScroll('left')" @click="onClick" @focusin="lastSide = 'left'" @keydown="onPaneKey">
        <div ref="leftBody" class="sd-body" :class="{ 'is-all': leftAll }" :style="bodyWidth ? { minWidth: bodyWidth } : undefined" v-html="leftHtml" />
      </div>
      <div class="sd-gutter relative shrink-0 overflow-hidden" :style="{ width: `${GUTTER_W}px` }">
        <svg class="absolute inset-0 size-full" aria-hidden="true">
          <path v-for="f in shown" :key="f.block" class="sd-conn" :class="[f.type, f.block === current ? 'is-current' : '']" :d="connectorPath(f, lh, top.left, top.right, GUTTER_W)" />
        </svg>
        <template v-if="canRevert">
          <button
            v-for="f in shown"
            :key="`rv-${f.block}`"
            type="button"
            class="rv absolute left-1"
            :style="{ top: `${revertTop(f)}px` }"
            :data-revert="f.block"
            :aria-disabled="revertBlocked ? 'true' : undefined"
            :title="revertBlocked ?? t('workspace.diff.revert')"
            :aria-label="revertBlocked ?? t('workspace.diff.revert')"
            @click="revert(f.block)"
          >
            <ChevronsRight :size="12" aria-hidden="true" />
          </button>
        </template>
      </div>
      <div ref="rightEl" class="sd-pane ccm-scroll" tabindex="0" role="document" data-side="right" :aria-label="sides.right" @scroll.passive="onScroll('right')" @click="onClick" @focusin="lastSide = 'right'" @keydown="onPaneKey">
        <div ref="rightBody" class="sd-body" :class="{ 'is-all': rightAll }" :style="bodyWidth ? { minWidth: bodyWidth } : undefined" v-html="rightHtml" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * JetBrains colours: modified blue, inserted green, deleted grey (a neutral ink step, not red). The well follows the
 * theme (dark in most, light in xcode / solarized / github / islands light), so every colour is a mix of well tokens.
 */
.is-split {
  --mod-ink: var(--ccm-diff-mod-well);
  --add-ink: var(--ccm-diff-add-well);
  --del-ink: color-mix(in srgb, var(--ccm-well-ink) 60%, var(--ccm-well));
  --mod-bg: color-mix(in srgb, var(--mod-ink) 16%, transparent);
  --add-bg: color-mix(in srgb, var(--add-ink) 14%, transparent);
  --del-bg: color-mix(in srgb, var(--del-ink) 18%, transparent);
  --mod-word: color-mix(in srgb, var(--mod-ink) 38%, transparent);
  color: var(--shiki-foreground);
  font-family: var(--font-mono);
  font-size: calc(var(--ccm-code-size, 13px) - 0.5px);
  font-variant-ligatures: none;
  tab-size: 4;
}
.sd-heads {
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 22px;
  color: var(--ccm-well-ink);
}
.sd-pane {
  position: relative;
  min-width: 0;
  flex: 1 1 0;
  overflow: auto;
  outline: none;
}
.sd-pane:focus-visible {
  box-shadow: inset 0 0 0 2px var(--ccm-focus);
}
.sd-body {
  position: relative;
  width: max-content;
  min-width: 100%;
}
.sd-probe {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
}
.is-split :deep(.sd-row) {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  height: 1.5em;
  line-height: 1.5em;
  white-space: pre;
}
.is-split :deep(.n) {
  min-width: 3.25em;
  padding-inline: 0.5em;
  text-align: right;
  color: color-mix(in srgb, var(--ccm-well-ink) 55%, var(--ccm-well));
  user-select: none;
  font-variant-numeric: tabular-nums;
}
.is-split :deep(.c) {
  padding-right: 1.5em;
}
.is-split :deep(.sd-row.modified) {
  background: var(--mod-bg);
}
.is-split :deep(.sd-row.added) {
  background: var(--add-bg);
}
.is-split :deep(.sd-row.deleted) {
  background: var(--del-bg);
}
.is-split :deep(.sd-row.pad.modified) {
  background: color-mix(in srgb, var(--mod-ink) 7%, transparent);
}
.is-split :deep(.sd-row.pad.added) {
  background: color-mix(in srgb, var(--add-ink) 6%, transparent);
}
.is-split :deep(.sd-row.pad.deleted) {
  background: color-mix(in srgb, var(--del-ink) 8%, transparent);
}
/* Highlight "None": rows keep the code colours; only the number column and the gutter show the change. */
.is-split.hl-none :deep(.sd-row.modified),
.is-split.hl-none :deep(.sd-row.added),
.is-split.hl-none :deep(.sd-row.deleted) {
  background: transparent;
}
.is-split.hl-none :deep(.sd-row.modified > .n) {
  background: var(--mod-bg);
}
.is-split.hl-none :deep(.sd-row.added > .n) {
  background: var(--add-bg);
}
.is-split.hl-none :deep(.sd-row.deleted > .n) {
  background: var(--del-bg);
}
.is-split :deep(mark.w-mod) {
  color: inherit;
  border-radius: 2px;
  background: var(--mod-word);
}
.is-split :deep(mark.w-add) {
  color: inherit;
  border-radius: 2px;
  background: color-mix(in srgb, var(--add-ink) 34%, transparent);
}
.is-split :deep(mark.w-del) {
  color: inherit;
  border-radius: 2px;
  background: color-mix(in srgb, var(--del-ink) 36%, transparent);
}
.is-split :deep(.sd-mark) {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  margin-top: -0.5px;
  background: var(--del-ink);
}
.is-split :deep(.sd-mark.added) {
  background: var(--add-ink);
}
.is-split :deep(.is-current > .n) {
  box-shadow: inset 2px 0 0 var(--ccm-focus);
}
.is-split :deep(.sd-mark.is-current) {
  height: 2px;
  background: var(--ccm-focus);
}
.is-split :deep(.sd-row.note .c),
.is-split :deep(.sd-row.gap .c) {
  font-style: italic;
  color: var(--ccm-syn-comment);
  user-select: none;
}
.is-split :deep(.sd-row.fold) {
  background: color-mix(in srgb, var(--ccm-well-ink) 4%, var(--ccm-well));
  box-shadow:
    inset 0 1px 0 var(--ccm-well-line),
    inset 0 -1px 0 var(--ccm-well-line);
}
.is-split :deep(.sd-row.fold button) {
  text-align: left;
  color: var(--ccm-syn-comment);
  cursor: pointer;
}
.is-split :deep(.sd-row.fold button:hover) {
  color: var(--ccm-well-ink);
}
.is-split :deep(.sd-row.fold button:focus-visible) {
  outline: 2px solid var(--ccm-focus);
  outline-offset: -1px;
}
.sd-gutter {
  border-inline: 1px solid var(--ccm-well-line);
}
.sd-conn {
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.sd-conn.modified {
  fill: color-mix(in srgb, var(--mod-ink) 24%, transparent);
  stroke: color-mix(in srgb, var(--mod-ink) 60%, transparent);
}
.sd-conn.added {
  fill: color-mix(in srgb, var(--add-ink) 22%, transparent);
  stroke: color-mix(in srgb, var(--add-ink) 60%, transparent);
}
.sd-conn.deleted {
  fill: color-mix(in srgb, var(--del-ink) 26%, transparent);
  stroke: color-mix(in srgb, var(--del-ink) 60%, transparent);
}
.sd-conn.is-current {
  stroke: var(--ccm-focus);
  stroke-width: 1.5;
}
.rv {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--ccm-well-ink);
  background: var(--ccm-well);
  cursor: pointer;
}
.rv:hover:not([aria-disabled='true']) {
  background: var(--ccm-well-line);
  color: var(--mod-ink);
}
.rv[aria-disabled='true'] {
  cursor: not-allowed;
  color: color-mix(in srgb, var(--ccm-well-ink) 40%, var(--ccm-well));
}
.rv:focus-visible {
  outline: 2px solid var(--ccm-focus);
  outline-offset: -1px;
}
.is-split ::selection,
.is-split :deep(*)::selection {
  background: var(--ccm-well-selection);
}
/* Windowed Ctrl/⌘+A on one side (see FilePane): "all" is painted on its text rows. */
.sd-body.is-all :deep(.sd-row:not(.pad):not(.fold):not(.gap):not(.note) .c) {
  background: var(--ccm-well-selection);
}
</style>
