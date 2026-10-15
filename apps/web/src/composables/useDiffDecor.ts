import { computed, shallowRef, watch } from 'vue'
import { renderLine, type CodeToken } from '../lib/codeView'
import type { DiffFile, DiffLine } from '../lib/diff'
import { wordDiff, type Block, type WordMark } from '../lib/diffBlocks'
import type { DiffHighlight } from '../lib/diffOpts'
import { tokenize } from '../lib/highlight'

export interface DiffDecorSource {
  file: () => DiffFile
  blocks: () => readonly Block[]
  /** shiki grammar id, null = plain. */
  lang: () => string | null
  highlight: () => DiffHighlight
}

/** Syntax tokens and changed-word marks of a diff, shared by the inline and side-by-side viewers. */
export function useDiffDecor(src: DiffDecorSource) {
  const tokens = shallowRef<Map<DiffLine, CodeToken[]>>(new Map())
  let seq = 0

  /** Old and new sides are tokenized as two continuous texts so multi-line constructs keep their colours. */
  async function highlight(): Promise<void> {
    const run = ++seq
    tokens.value = new Map()
    const lang = src.lang()
    if (!lang) return
    const olds: DiffLine[] = []
    const news: DiffLine[] = []
    for (const h of src.file().hunks) {
      for (const l of h.lines) {
        if (l.type === 'del' || l.type === 'ctx') olds.push(l)
        if (l.type === 'add' || l.type === 'ctx') news.push(l)
      }
    }
    const [oldTok, newTok] = await Promise.all([tokenize(olds.map((l) => l.text).join('\n'), lang), tokenize(news.map((l) => l.text).join('\n'), lang)])
    if (run !== seq) return
    const map = new Map<DiffLine, CodeToken[]>()
    olds.forEach((l, i) => oldTok?.[i] && map.set(l, oldTok[i]!))
    news.forEach((l, i) => newTok?.[i] && map.set(l, newTok[i]!))
    tokens.value = map
  }

  watch(() => [src.file(), src.lang()] as const, () => void highlight(), { immediate: true })

  /** Line → its block index, and word marks per line of Modified blocks. */
  const lineInfo = computed(() => {
    const block = new Map<DiffLine, number>()
    const marks = new Map<DiffLine, WordMark[]>()
    const mode = src.highlight()
    const blocks = src.blocks()
    const mark = (dels: readonly DiffLine[], adds: readonly DiffLine[]): void => {
      const res = wordDiff(
        dels.map((l) => l.text),
        adds.map((l) => l.text),
        mode === 'chars' ? 'chars' : 'words',
      )
      if (!res) return
      dels.forEach((l, k) => res.old[k]!.length && marks.set(l, res.old[k]!))
      adds.forEach((l, k) => res.new[k]!.length && marks.set(l, res.new[k]!))
    }
    blocks.forEach((b, i) => {
      for (const l of b.dels) block.set(l, i)
      for (const l of b.adds) block.set(l, i)
      if (mode === 'lines' || mode === 'none') return
      if (b.type === 'modified') mark(b.dels, b.adds)
      // Split changes: a Deleted part right before its Inserted part (one Modified run) keeps its word marks.
      const next = blocks[i + 1]
      if (mode === 'split' && b.type === 'deleted' && next?.type === 'added' && next.hunk === b.hunk && next.from === b.to) mark(b.dels, next.adds)
    })
    return { block, marks }
  })

  /** Line HTML: syntax tokens plus changed-word marks with class `cls`. */
  function code(l: DiffLine | undefined, cls: string): string {
    if (!l) return ''
    const words = lineInfo.value.marks.get(l)
    return renderLine(tokens.value.get(l) ?? [{ content: l.text }], words?.map((m) => ({ ...m, cls })))
  }

  return { lineInfo, code }
}
