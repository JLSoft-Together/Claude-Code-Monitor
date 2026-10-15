import { computed, shallowRef, watch } from 'vue'
import { renderLine, type CodeToken } from '../lib/codeView'
import type { DiffFile, DiffLine } from '../lib/diff'
import type { Block, WordMark } from '../lib/diffBlocks'
import type { DiffHighlight } from '../lib/diffOpts'
import { tokenize, wordDiffs, type WordDiffPair } from '../lib/highlight'

export interface DiffDecorSource {
  file: () => DiffFile
  blocks: () => readonly Block[]
  /** shiki grammar id, null = plain. */
  lang: () => string | null
  highlight: () => DiffHighlight
}

let instances = 0

/**
 * Syntax tokens and changed-word marks of a diff, shared by the inline and side-by-side viewers. Both are computed in
 * the highlight worker: rows show plain first and pick up colours / marks when they arrive.
 */
export function useDiffDecor(src: DiffDecorSource) {
  const id = ++instances
  const tokens = shallowRef<Map<DiffLine, CodeToken[]>>(new Map())
  const marks = shallowRef<Map<DiffLine, WordMark[]>>(new Map())
  let seq = 0
  let markSeq = 0

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
    const [oldTok, newTok] = await Promise.all([
      tokenize(olds.map((l) => l.text).join('\n'), lang, `diff${id}:old`),
      tokenize(news.map((l) => l.text).join('\n'), lang, `diff${id}:new`),
    ])
    if (run !== seq) return
    const map = new Map<DiffLine, CodeToken[]>()
    olds.forEach((l, i) => oldTok?.[i] && map.set(l, oldTok[i]!))
    news.forEach((l, i) => newTok?.[i] && map.set(l, newTok[i]!))
    tokens.value = map
  }

  watch(() => [src.file(), src.lang()] as const, () => void highlight(), { immediate: true })

  /** Line → its block index. */
  const lineInfo = computed(() => {
    const block = new Map<DiffLine, number>()
    src.blocks().forEach((b, i) => {
      for (const l of b.dels) block.set(l, i)
      for (const l of b.adds) block.set(l, i)
    })
    return { block, marks: marks.value }
  })

  /** Word marks per line of Modified blocks (and of Deleted + Added pairs under "Split changes"). */
  async function markWords(): Promise<void> {
    const run = ++markSeq
    const mode = src.highlight()
    const blocks = src.blocks()
    const sides: { dels: readonly DiffLine[]; adds: readonly DiffLine[] }[] = []
    if (mode !== 'lines' && mode !== 'none') {
      blocks.forEach((b, i) => {
        if (b.type === 'modified') sides.push({ dels: b.dels, adds: b.adds })
        // Split changes: a Deleted part right before its Inserted part (one Modified run) keeps its word marks.
        const next = blocks[i + 1]
        if (mode === 'split' && b.type === 'deleted' && next?.type === 'added' && next.hunk === b.hunk && next.from === b.to) sides.push({ dels: b.dels, adds: next.adds })
      })
    }
    if (!sides.length) {
      if (marks.value.size) marks.value = new Map()
      return
    }
    const pairs: WordDiffPair[] = sides.map((s) => ({ old: s.dels.map((l) => l.text), new: s.adds.map((l) => l.text), mode: mode === 'chars' ? 'chars' : 'words' }))
    const res = await wordDiffs(pairs, `diff${id}:words`)
    if (run !== markSeq || !res) return
    const map = new Map<DiffLine, WordMark[]>()
    res.forEach((r, i) => {
      if (!r) return
      const s = sides[i]!
      s.dels.forEach((l, k) => r.old[k]!.length && map.set(l, r.old[k]!))
      s.adds.forEach((l, k) => r.new[k]!.length && map.set(l, r.new[k]!))
    })
    marks.value = map
  }

  watch(() => [src.blocks(), src.highlight()] as const, () => void markWords(), { immediate: true })

  /** Line HTML: syntax tokens plus changed-word marks with class `cls`. */
  function code(l: DiffLine | undefined, cls: string): string {
    if (!l) return ''
    const words = marks.value.get(l)
    return renderLine(tokens.value.get(l) ?? [{ content: l.text }], words?.map((m) => ({ ...m, cls })))
  }

  return { lineInfo, code }
}
