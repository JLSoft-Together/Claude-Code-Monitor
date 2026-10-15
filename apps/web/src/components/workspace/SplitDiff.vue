<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronsRight } from 'lucide-vue-next'
import { escapeHtml } from '../../lib/codeView'
import type { DiffFile } from '../../lib/diff'
import type { Block } from '../../lib/diffBlocks'
import type { DiffHighlight } from '../../lib/diffOpts'
import { connectorPath, mapRow, midRow, scrollTopFor, splitModel, visibleFragments, type Fragment, type Side, type SplitRow } from '../../lib/splitDiff'
import { useDiffDecor } from '../../composables/useDiffDecor'

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
}>()
const emit = defineEmits<{ revert: [index: number]; focusBlock: [index: number] }>()

const { t } = useI18n()
const GUTTER_W = 44
const BUTTON = 18

const { code } = useDiffDecor({ file: () => props.file, blocks: () => props.blocks, lang: () => props.lang, highlight: () => props.highlight })
const root = ref<HTMLElement | null>(null)
const leftEl = ref<HTMLElement | null>(null)
const rightEl = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)
/** Row height in px: rows are 1.5em of the code font, measured so zoom and font changes stay exact. */
const lh = ref(19.5)
const viewH = ref(0)
const top = reactive({ left: 0, right: 0 })
/** `${hunk}:${unit}` of folds the user opened; reset per file. */
const expanded = ref<Set<string>>(new Set())

const model = computed(() => splitModel(props.file, props.blocks, { collapse: props.collapse, context: props.context, expanded: expanded.value }))
const shown = computed(() => visibleFragments(model.value.frags, lh.value, top.left, top.right, viewH.value))
const el = (side: Side): HTMLElement | null => (side === 'left' ? leftEl.value : rightEl.value)
const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')

const num = (n: number | undefined): string => (n === undefined ? '' : String(n))

function rowHtml(r: SplitRow, side: Side): string {
  if (r.kind === 'gap') return `<div class="sd-row gap" aria-hidden="true"><span class="n"></span><span class="c">⋯</span></div>`
  if (r.kind === 'fold') {
    const label = escapeHtml(t('workspace.diff.expand', { n: r.count }, r.count))
    return `<div class="sd-row fold"><span class="n"></span><button type="button" class="c" data-fold="${r.key}">⋯ ${label}</button></div>`
  }
  if (r.kind === 'note') return `<div class="sd-row note"><span class="n"></span><span class="c">${escapeHtml(r.text)}</span></div>`
  const l = r.line
  const n = num(side === 'left' ? l.old : l.new)
  const newAttr = side === 'right' && l.new ? ` data-new="${l.new}"` : ''
  if (r.block === null) return `<div class="sd-row"${newAttr}><span class="n">${n}</span><span class="c">${code(l, 'w-mod')}\n</span></div>`
  const type = props.blocks[r.block]!.type
  const kind = escapeHtml(t(`workspace.gutter.kind.${type}`))
  return `<div class="sd-row ${type}" data-block="${r.block}"${newAttr}><span class="n" title="${kind}">${n}</span><span class="c">${code(l, 'w-mod')}\n</span></div>`
}

/** Rows, then a thin line where a fragment has no rows on this side (Inserted on the left, Deleted on the right). */
function sideHtml(side: Side): string {
  const rows = side === 'left' ? model.value.left : model.value.right
  let out = ''
  for (const r of rows) out += rowHtml(r, side)
  for (const f of model.value.frags) {
    const at = side === 'left' ? f.l1Start : f.l2Start
    const empty = side === 'left' ? f.l1Start === f.l1End : f.l2Start === f.l2End
    if (empty) out += `<div class="sd-mark ${f.type}" data-block="${f.block}" style="top: calc(${at} * 1.5em)" aria-hidden="true"></div>`
  }
  return out
}

const leftHtml = computed(() => sideHtml('left'))
const rightHtml = computed(() => sideHtml('right'))

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
  if (syncing === side) return
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

watch(
  () => props.file,
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

async function scrollToBlock(i: number): Promise<void> {
  await nextTick()
  markCurrent()
  const f = model.value.frags.find((x) => x.block === i)
  if (!f) return
  const side: Side = f.l2End > f.l2Start ? 'right' : 'left'
  const pane = el(side)
  if (!pane) return
  pane.scrollTop = scrollTopFor(side === 'right' ? f.l2Start : f.l1Start, lh.value, pane.clientHeight)
  onScroll(side)
}

defineExpose({ scrollToBlock })
</script>

<template>
  <div
    ref="root"
    class="is-split flex h-full min-h-0 min-w-0 flex-col"
    data-code-zoom
    data-split-diff
    :aria-label="blocks.length ? t('workspace.diff.change', { n: current + 1, total: blocks.length }) : undefined"
  >
    <div class="sd-heads flex shrink-0 border-b border-well-line">
      <span class="min-w-0 flex-1 truncate px-2" :title="sides.left">{{ sides.left }}</span>
      <span class="shrink-0" :style="{ width: `${GUTTER_W}px` }" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate px-2" :title="sides.right">{{ sides.right }}</span>
    </div>
    <div class="relative flex min-h-0 flex-1">
      <div ref="probe" class="sd-row sd-probe" aria-hidden="true"><span class="n">0</span><span class="c">0</span></div>
      <div ref="leftEl" class="sd-pane ccm-scroll" tabindex="0" role="document" data-side="left" :aria-label="sides.left" @scroll.passive="onScroll('left')" @click="onClick">
        <div class="sd-body" v-html="leftHtml" />
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
      <div ref="rightEl" class="sd-pane ccm-scroll" tabindex="0" role="document" data-side="right" :aria-label="sides.right" @scroll.passive="onScroll('right')" @click="onClick">
        <div class="sd-body" v-html="rightHtml" />
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
.is-split :deep(mark.w-mod) {
  color: inherit;
  border-radius: 2px;
  background: var(--mod-word);
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
</style>
