import type { DiffFile, DiffLine } from './diff'

export type BlockType = 'added' | 'deleted' | 'modified'

/**
 * One change block (IntelliJ `Range`): a run of `del` / `add` lines inside a hunk. Lines are 0-based,
 * half-open: `line1 == line2` = nothing left on the current side (Deleted), `vcsLine1 == vcsLine2` = Added.
 */
export interface Block {
  /** Index into `file.hunks`. */
  hunk: number
  /** `[from, to)` indices into that hunk's `lines`. */
  from: number
  to: number
  line1: number
  line2: number
  vcsLine1: number
  vcsLine2: number
  type: BlockType
  dels: DiffLine[]
  adds: DiffLine[]
}

/** Every change block of a parsed diff, in file order. */
export function changeBlocks(file: DiffFile): Block[] {
  const out: Block[] = []
  file.hunks.forEach((h, hi) => {
    // `@@ -0,0 +1,3 @@`: a zero count names the line before the hunk.
    let oldNo = h.oldCount === 0 ? h.oldStart + 1 : h.oldStart
    let newNo = h.newCount === 0 ? h.newStart + 1 : h.newStart
    let run: Block | null = null
    const close = (at: number): void => {
      if (!run) return
      run.to = at
      run.line2 = newNo - 1
      run.vcsLine2 = oldNo - 1
      run.type = run.adds.length && run.dels.length ? 'modified' : run.adds.length ? 'added' : 'deleted'
      out.push(run)
      run = null
    }
    h.lines.forEach((l, i) => {
      if (l.type === 'ctx') {
        close(i)
        oldNo++
        newNo++
        return
      }
      if (l.type === 'note') return
      run ??= { hunk: hi, from: i, to: i, line1: newNo - 1, line2: newNo - 1, vcsLine1: oldNo - 1, vcsLine2: oldNo - 1, type: 'modified', dels: [], adds: [] }
      if (l.type === 'del') {
        run.dels.push(l)
        oldNo++
      } else {
        run.adds.push(l)
        newNo++
      }
    })
    // A trailing "\ No newline" note belongs to the block it follows.
    close(h.lines.length)
  })
  return out
}

/** Block covering current-side line `line` (0-based); a Deleted block answers for the line right after the removal. */
export function blockAt(blocks: readonly Block[], line: number): number {
  return blocks.findIndex((b) => (b.line1 === b.line2 ? b.line1 === line : line >= b.line1 && line < b.line2))
}

/**
 * Patch holding only `block`, for `git apply -R` against the working tree (Rollback / revert arrow).
 * Up to `context` current-side lines around it; other blocks in that window are already "current":
 * their additions become context and their deletions are dropped. Raw lines keep CR, as git printed them.
 */
export function blockPatch(file: DiffFile, block: Block, context = 3): string {
  const lines = file.hunks[block.hunk]!.lines
  const asContext = (l: DiffLine): string | null => (l.type === 'ctx' ? l.raw : l.type === 'add' ? ` ${l.raw.slice(1)}` : null)

  const before: string[] = []
  for (let i = block.from - 1; i >= 0 && before.length < context; i--) {
    const c = asContext(lines[i]!)
    if (c !== null) before.unshift(c)
  }
  const after: string[] = []
  for (let i = block.to; i < lines.length && after.length < context; i++) {
    const l = lines[i]!
    if (l.type === 'note') {
      // "\ No newline" after a line we kept still describes it.
      if (after.length && lines[i - 1]?.type !== 'del') after.push(l.raw)
      continue
    }
    const c = asContext(l)
    if (c !== null) after.push(c)
  }
  const body = lines.slice(block.from, block.to).map((l) => l.raw)
  const ctxCount = before.length + after.filter((l) => !l.startsWith('\\')).length
  const oldCount = ctxCount + block.dels.length
  const newCount = ctxCount + block.adds.length
  // Lines before the window are the same on both sides (nothing above is reverted).
  const firstNew = block.line1 - before.length + 1
  const newStart = newCount ? firstNew : block.line1
  const oldStart = newCount ? (oldCount ? firstNew : firstNew - 1) : block.line1 + 1
  const a = file.oldPath ?? file.path
  const b = file.newPath ?? file.path
  return [`diff --git a/${a} b/${b}`, `--- a/${a}`, `+++ b/${b}`, `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...before, ...body, ...after, ''].join('\n')
}

export interface WordMark {
  start: number
  end: number
}

/** Max tokens(old) × tokens(new) for the LCS table; past it the block keeps line highlight only. */
export const WORD_DIFF_LIMIT = 250_000

const TOKEN = /\w+|\s+|[^\w\s]/gu
const CHAR = /[\s\S]/gu

/**
 * Changed words (or characters) of a Modified block: LCS over word / space / symbol tokens of the whole block, so a
 * word moved to the next line still pairs up. Returns per-line column ranges for each side; null past the limit.
 */
export function wordDiff(oldLines: readonly string[], newLines: readonly string[], mode: 'words' | 'chars' = 'words'): { old: WordMark[][]; new: WordMark[][] } | null {
  const re = mode === 'chars' ? CHAR : TOKEN
  const tok = (lines: readonly string[]) => {
    const out: { text: string; line: number; start: number }[] = []
    lines.forEach((text, line) => {
      for (const m of text.matchAll(re)) out.push({ text: m[0], line, start: m.index })
    })
    return out
  }
  const a = tok(oldLines)
  const b = tok(newLines)
  let head = 0
  while (head < a.length && head < b.length && a[head]!.text === b[head]!.text) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail]!.text === b[b.length - 1 - tail]!.text) tail++
  const ai = a.slice(head, a.length - tail)
  const bi = b.slice(head, b.length - tail)
  const n = ai.length
  const m = bi.length
  // Chars mode has ~5× the tokens: a block too big for it can still get word marks.
  if (n * m > WORD_DIFF_LIMIT) return mode === 'chars' ? wordDiff(oldLines, newLines, 'words') : null

  const keepA = new Uint8Array(n)
  const keepB = new Uint8Array(m)
  if (n && m) {
    // LCS lengths of suffixes, then one forward walk.
    const w = m + 1
    const dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = ai[i]!.text === bi[j]!.text ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (ai[i]!.text === bi[j]!.text) {
        keepA[i++] = 1
        keepB[j++] = 1
      } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++
      else j++
    }
  }

  const marks = (toks: typeof ai, keep: Uint8Array, lineCount: number): WordMark[][] => {
    const out: WordMark[][] = Array.from({ length: lineCount }, () => [])
    toks.forEach((t, k) => {
      if (keep[k]) return
      const list = out[t.line]!
      const end = t.start + t.text.length
      const last = list[list.length - 1]
      if (last && last.end === t.start) last.end = end
      else list.push({ start: t.start, end })
    })
    return out
  }
  return { old: marks(ai, keepA, oldLines.length), new: marks(bi, keepB, newLines.length) }
}

export type FoldSegment = { kind: 'rows'; from: number; to: number } | { kind: 'fold'; from: number; to: number }

/** Shortest unchanged run worth folding; shorter runs stay visible. */
export const MIN_FOLD = 3

/**
 * Collapse unchanged: rows `[from, to)` to show, and runs of unchanged rows farther than `context` from any
 * change folded. `expanded` holds the `from` of folds the user opened.
 */
export function foldRows(changed: readonly boolean[], context: number, expanded: ReadonlySet<number> = new Set()): FoldSegment[] {
  const n = changed.length
  const keep = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!changed[i]) continue
    for (let k = Math.max(0, i - context); k <= Math.min(n - 1, i + context); k++) keep[k] = 1
  }
  const out: FoldSegment[] = []
  const push = (kind: FoldSegment['kind'], from: number, to: number): void => {
    const last = out[out.length - 1]
    if (kind === 'rows' && last?.kind === 'rows' && last.to === from) last.to = to
    else out.push({ kind, from, to })
  }
  let i = 0
  while (i < n) {
    let j = i
    if (keep[i]) {
      while (j < n && keep[j]) j++
      push('rows', i, j)
    } else {
      while (j < n && !keep[j]) j++
      push(j - i >= MIN_FOLD && !expanded.has(i) ? 'fold' : 'rows', i, j)
    }
    i = j
  }
  return out
}
