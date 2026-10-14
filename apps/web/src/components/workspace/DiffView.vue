<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Undo2 } from 'lucide-vue-next'
import { escapeHtml, renderLine, type CodeToken } from '../../lib/codeView'
import { sideBySide, type DiffFile, type DiffLine } from '../../lib/diff'
import { tokenize } from '../../lib/highlight'

const props = defineProps<{
  file: DiffFile
  layout: 'inline' | 'split'
  /** shiki grammar id, null = plain. */
  lang: string | null
  canDiscardHunks: boolean
  currentHunk: number
}>()
const emit = defineEmits<{ discardHunk: [index: number]; focusHunk: [index: number] }>()

const { t } = useI18n()
const tokens = shallowRef<Map<DiffLine, CodeToken[]>>(new Map())
const root = ref<HTMLElement | null>(null)
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

const code = (l: DiffLine | undefined): string => (l ? renderLine(tokens.value.get(l) ?? [{ content: l.text }]) : '')
const num = (n: number | undefined): string => (n === undefined ? '' : String(n))
const SIGN = { add: '+', del: '−', ctx: ' ', note: '' } as const

function inlineHtml(lines: readonly DiffLine[]): string {
  let out = ''
  for (const l of lines) {
    if (l.type === 'note') {
      out += `<div class="r note"><span class="n"></span><span class="n"></span><span class="s"></span><span class="c">${escapeHtml(l.text)}</span></div>`
      continue
    }
    out += `<div class="r ${l.type}"${l.new ? ` data-new="${l.new}"` : ''}><span class="n">${num(l.old)}</span><span class="n">${num(l.new)}</span><span class="s">${SIGN[l.type]}</span><span class="c">${code(l)}\n</span></div>`
  }
  return out
}

function splitHtml(lines: readonly DiffLine[]): string {
  let out = ''
  for (const row of sideBySide({ header: '', oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, section: '', lines: [...lines] })) {
    const l = row.left
    const r = row.right
    const lc = l ? (l.type === 'ctx' ? 'ctx' : 'del') : 'empty'
    const rc = r ? (r.type === 'ctx' ? 'ctx' : 'add') : 'empty'
    out +=
      `<div class="r2"><span class="n ${lc}">${num(l?.old)}</span><span class="c ${lc}"><span class="s">${l && l.type !== 'ctx' ? SIGN.del : ''}</span>${code(l)}\n</span>` +
      `<span class="n ${rc}">${num(r?.new)}</span><span class="c ${rc}"><span class="s">${r && r.type !== 'ctx' ? SIGN.add : ''}</span>${code(r)}\n</span></div>`
  }
  return out
}

const hunks = computed(() =>
  props.file.hunks.map((h, i) => ({
    index: i,
    header: h.header.replace(/^(@@ [^@]+ @@).*$/, '$1'),
    section: h.section,
    html: props.layout === 'split' ? splitHtml(h.lines) : inlineHtml(h.lines),
  })),
)

async function scrollToHunk(i: number): Promise<void> {
  await nextTick()
  const el = root.value?.querySelector<HTMLElement>(`[data-hunk="${i}"]`)
  el?.scrollIntoView({ block: 'start' })
  el?.querySelector<HTMLElement>('.hunk-head')?.focus({ preventScroll: true })
}

defineExpose({ scrollToHunk })
</script>

<template>
  <div ref="root" class="diff ccm-code min-w-full py-1" :class="layout === 'split' ? 'is-split' : 'w-max'" role="document">
    <section
      v-for="h in hunks"
      :key="h.index"
      :data-hunk="h.index"
      class="hunk"
      :class="h.index === currentHunk ? 'is-current' : ''"
      :aria-label="t('workspace.changes.hunk', { n: h.index + 1, total: hunks.length })"
    >
      <div class="hunk-head sticky top-0 z-[1] flex items-center gap-2 py-1 pl-3 pr-1.5" tabindex="-1" @focus="emit('focusHunk', h.index)">
        <span class="shrink-0 font-mono">{{ h.header }}</span>
        <span class="min-w-0 flex-1 truncate font-mono">{{ h.section }}</span>
        <button v-if="canDiscardHunks" type="button" class="discard ccm-btn-plain shrink-0 gap-1 text-2xs" @click="emit('discardHunk', h.index)">
          <Undo2 :size="12" aria-hidden="true" />
          {{ t('workspace.changes.discardHunk') }}
        </button>
      </div>
      <div class="lines" v-html="h.html" />
    </section>
  </div>
</template>

<style scoped>
/* On the well: diff tints use the well diff inks; shiki colours come from .ccm-code (style.css). */
.diff {
  --add-ink: var(--ccm-diff-add-well);
  --del-ink: var(--ccm-diff-del-well);
  --add-bg: color-mix(in srgb, var(--add-ink) 16%, transparent);
  --del-bg: color-mix(in srgb, var(--del-ink) 18%, transparent);
  color: var(--shiki-foreground);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.5;
  tab-size: 4;
}
.hunk + .hunk {
  margin-top: 6px;
}
.hunk-head {
  font-size: 11.5px;
  color: var(--ccm-syn-comment, #7f8c98);
  background: color-mix(in srgb, var(--ccm-well-ink) 7%, var(--ccm-well));
  border-block: 1px solid var(--ccm-well-line);
  outline: none;
}
.hunk-head:focus-visible,
.hunk.is-current .hunk-head {
  box-shadow: inset 2px 0 0 var(--ccm-focus);
}
.hunk-head .discard {
  min-height: 22px;
  color: var(--ccm-well-ink);
}
.hunk-head .discard:hover {
  background: var(--ccm-well-line);
  color: var(--del-ink);
}
.lines :deep(.r) {
  display: grid;
  grid-template-columns: max-content max-content 1.5em minmax(0, 1fr);
}
.lines :deep(.n) {
  min-width: 3.25em;
  padding-inline: 0.5em;
  text-align: right;
  color: color-mix(in srgb, var(--ccm-well-ink) 50%, var(--ccm-well));
  user-select: none;
  font-variant-numeric: tabular-nums;
}
.lines :deep(.s) {
  user-select: none;
  text-align: center;
}
.lines :deep(.c) {
  padding-right: 1.5em;
  white-space: pre;
}
.lines :deep(.r.add) {
  background: var(--add-bg);
}
.lines :deep(.r.del) {
  background: var(--del-bg);
}
.lines :deep(.r.add .s) {
  color: var(--add-ink);
}
.lines :deep(.r.del .s) {
  color: var(--del-ink);
}
.lines :deep(.r.note .c) {
  font-style: italic;
  color: var(--ccm-syn-comment, #7f8c98);
}
.is-split .lines :deep(.r2) {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr);
}
.is-split .lines :deep(.c) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.is-split .lines :deep(.c .s) {
  display: inline-block;
  width: 1.25em;
}
.is-split .lines :deep(.add) {
  background: var(--add-bg);
}
.is-split .lines :deep(.del) {
  background: var(--del-bg);
}
.is-split .lines :deep(.add .s) {
  color: var(--add-ink);
}
.is-split .lines :deep(.del .s) {
  color: var(--del-ink);
}
.is-split .lines :deep(.empty) {
  background: color-mix(in srgb, var(--ccm-well-ink) 4%, transparent);
}
.is-split .lines :deep(.n + .c + .n) {
  border-left: 1px solid var(--ccm-well-line);
}
.diff ::selection,
.diff :deep(*)::selection {
  background: var(--ccm-well-selection, #3f638b);
}
</style>
