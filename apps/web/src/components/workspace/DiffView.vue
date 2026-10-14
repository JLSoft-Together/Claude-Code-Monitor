<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { escapeHtml, renderLine, type CodeToken } from '../../lib/codeView'
import { sideBySide, type DiffFile, type DiffLine } from '../../lib/diff'
import { foldRows, wordDiff, type Block, type WordMark } from '../../lib/diffBlocks'
import { tokenize } from '../../lib/highlight'

const props = defineProps<{
  file: DiffFile
  blocks: Block[]
  layout: 'inline' | 'split'
  /** shiki grammar id, null = plain. */
  lang: string | null
  /** Fold unchanged runs farther than `context` lines from a change. */
  collapse: boolean
  context: number
  /** Word-level marks inside Modified blocks (IntelliJ "Highlight words"). */
  words: boolean
  /** Revert buttons shown; `revertBlocked` (a reason) keeps them visible but inert. */
  canRevert: boolean
  revertBlocked?: string | null
  current: number
}>()
const emit = defineEmits<{ revert: [index: number]; focusBlock: [index: number] }>()

const { t } = useI18n()
const tokens = shallowRef<Map<DiffLine, CodeToken[]>>(new Map())
const root = ref<HTMLElement | null>(null)
/** `${hunk}:${from}` of folds the user opened; reset per file. */
const expanded = ref<Set<string>>(new Set())
let seq = 0

/** Old and new sides are tokenized as two continuous texts so multi-line constructs keep their colours. */
async function highlight(): Promise<void> {
  const run = ++seq
  tokens.value = new Map()
  if (!props.lang) return
  const olds: DiffLine[] = []
  const news: DiffLine[] = []
  for (const h of props.file.hunks) {
    for (const l of h.lines) {
      if (l.type === 'del' || l.type === 'ctx') olds.push(l)
      if (l.type === 'add' || l.type === 'ctx') news.push(l)
    }
  }
  const [oldTok, newTok] = await Promise.all([
    tokenize(olds.map((l) => l.text).join('\n'), props.lang),
    tokenize(news.map((l) => l.text).join('\n'), props.lang),
  ])
  if (run !== seq) return
  const map = new Map<DiffLine, CodeToken[]>()
  olds.forEach((l, i) => oldTok?.[i] && map.set(l, oldTok[i]!))
  news.forEach((l, i) => newTok?.[i] && map.set(l, newTok[i]!))
  tokens.value = map
}

watch(() => [props.file, props.lang] as const, () => void highlight(), { immediate: true })
watch(
  () => props.file,
  () => (expanded.value = new Set()),
)

/** Line → its block index, and word marks per line of Modified blocks. */
const lineInfo = computed(() => {
  const block = new Map<DiffLine, number>()
  const marks = new Map<DiffLine, WordMark[]>()
  props.blocks.forEach((b, i) => {
    for (const l of b.dels) block.set(l, i)
    for (const l of b.adds) block.set(l, i)
    if (!props.words || b.type !== 'modified') return
    const res = wordDiff(
      b.dels.map((l) => l.text),
      b.adds.map((l) => l.text),
    )
    if (!res) return
    b.dels.forEach((l, k) => res.old[k]!.length && marks.set(l, res.old[k]!))
    b.adds.forEach((l, k) => res.new[k]!.length && marks.set(l, res.new[k]!))
  })
  return { block, marks }
})

const SVG = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const UNDO = SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>')
const CHEVRONS = SVG('<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>')

function code(l: DiffLine | undefined): string {
  if (!l) return ''
  const words = lineInfo.value.marks.get(l)
  const cls = l.type === 'add' ? 'w-add' : 'w-del'
  return renderLine(tokens.value.get(l) ?? [{ content: l.text }], words?.map((m) => ({ ...m, cls })))
}
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

function inlineRows(lines: readonly DiffLine[]): { changed: boolean[]; render: (i: number) => string } {
  const { block } = lineInfo.value
  return {
    changed: lines.map((l) => l.type === 'add' || l.type === 'del'),
    render: (i) => {
      const l = lines[i]!
      if (l.type === 'note') {
        return `<div class="r note"><span class="n"></span><span class="n"></span><span class="a"></span><span class="s"></span><span class="c">${escapeHtml(l.text)}</span></div>`
      }
      const b = block.get(l)
      const attrs = `${b !== undefined ? ` data-block="${b}"` : ''}${l.new ? ` data-new="${l.new}"` : ''}`
      const act = b !== undefined && firstOf.value.has(l) ? revertButton(b, UNDO) : ''
      return `<div class="r ${l.type}"${attrs}><span class="n">${num(l.old)}</span><span class="n">${num(l.new)}</span><span class="a">${act}</span><span class="s">${SIGN[l.type]}</span><span class="c">${code(l)}\n</span></div>`
    },
  }
}

function splitRows(lines: readonly DiffLine[]): { changed: boolean[]; render: (i: number) => string } {
  const { block } = lineInfo.value
  const rows = sideBySide({ header: '', oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, section: '', lines: [...lines] })
  return {
    changed: rows.map((r) => r.left?.type === 'del' || r.right?.type === 'add'),
    render: (i) => {
      const { left: l, right: r } = rows[i]!
      const lc = l ? (l.type === 'ctx' ? 'ctx' : 'del') : 'empty'
      const rc = r ? (r.type === 'ctx' ? 'ctx' : 'add') : 'empty'
      const b = (l && block.get(l)) ?? (r && block.get(r))
      const first = b !== undefined && ((l && firstOf.value.has(l)) || (r && firstOf.value.has(r)))
      return (
        `<div class="r2"${b !== undefined ? ` data-block="${b}"` : ''}${r?.new ? ` data-new="${r.new}"` : ''}>` +
        `<span class="n ${lc}">${num(l?.old)}</span><span class="c ${lc}"><span class="s">${l && l.type !== 'ctx' ? SIGN.del : ''}</span>${code(l)}\n</span>` +
        `<span class="a">${first ? revertButton(b!, CHEVRONS) : ''}</span>` +
        `<span class="n ${rc}">${num(r?.new)}</span><span class="c ${rc}"><span class="s">${r && r.type !== 'ctx' ? SIGN.add : ''}</span>${code(r)}\n</span></div>`
      )
    },
  }
}

const html = computed(() => {
  const split = props.layout === 'split'
  let out = ''
  props.file.hunks.forEach((h, hi) => {
    if (hi > 0) out += `<div class="gap" aria-hidden="true">⋯</div>`
    const { changed, render } = split ? splitRows(h.lines) : inlineRows(h.lines)
    const segments = props.collapse
      ? foldRows(changed, props.context, new Set([...expanded.value].filter((k) => k.startsWith(`${hi}:`)).map((k) => Number(k.slice(k.indexOf(':') + 1)))))
      : [{ kind: 'rows' as const, from: 0, to: changed.length }]
    for (const seg of segments) {
      if (seg.kind === 'fold') {
        out += foldHtml(`${hi}:${seg.from}`, seg.to - seg.from, split ? 'r2' : 'r')
        continue
      }
      for (let i = seg.from; i < seg.to; i++) out += render(i)
    }
  })
  return out
})

function markCurrent(): void {
  const el = root.value
  if (!el) return
  for (const r of el.querySelectorAll('.is-current')) r.classList.remove('is-current')
  for (const r of el.querySelectorAll(`[data-block="${props.current}"]`)) r.classList.add('is-current')
}

watch([html, () => props.current], () => void nextTick(markCurrent), { flush: 'post' })

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
  await nextTick()
  markCurrent()
  root.value?.querySelector<HTMLElement>(`[data-block="${i}"]`)?.scrollIntoView({ block: 'center' })
}

/** New-side line (1-based) at the top of block `i`, for F4. */
function lineOf(i: number): number | undefined {
  const b = props.blocks[i]
  return b ? Math.max(1, b.line1 + 1) : undefined
}

defineExpose({ scrollToBlock, lineOf })
</script>

<template>
  <div
    ref="root"
    class="diff ccm-code min-w-full py-1"
    :class="layout === 'split' ? 'is-split' : 'w-max'"
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
.is-split :deep(.r2) {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) 1.75em max-content minmax(0, 1fr);
}
.is-split :deep(.fold.r2) {
  display: block;
}
.is-split :deep(.c) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.is-split :deep(.c .s) {
  display: inline-block;
  width: 1.25em;
}
.is-split :deep(.add) {
  background: var(--add-bg);
}
.is-split :deep(.del) {
  background: var(--del-bg);
}
.is-split :deep(.add .s) {
  color: var(--add-ink);
}
.is-split :deep(.del .s) {
  color: var(--del-ink);
}
.is-split :deep(.empty) {
  background: color-mix(in srgb, var(--ccm-well-ink) 4%, transparent);
}
.is-split :deep(.a) {
  border-inline: 1px solid var(--ccm-well-line);
}
.diff ::selection,
.diff :deep(*)::selection {
  background: var(--ccm-well-selection, #3f638b);
}
</style>
