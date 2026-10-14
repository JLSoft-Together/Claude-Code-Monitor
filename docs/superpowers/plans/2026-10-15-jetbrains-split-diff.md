# JetBrains Side-by-Side Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the VS Code / GitHub style split diff (filler rows) with an Android Studio (JetBrains) one: each side keeps its real lines, a curved gutter connects changed ranges, both sides scroll in sync non-linearly, and changed words or characters are highlighted inside modified blocks.

**Architecture:** The diff the app already loads (`git diff -U1000000`, parsed into `DiffFile`, split into IntelliJ blocks by `changeBlocks`) is projected by a pure module `lib/splitDiff.ts` into rows per side + `Fragment[]` (row ranges), plus pure geometry (`mapRow`, `connectorPath`, `visibleFragments`). A new `SplitDiff.vue` renders two scroll panes and an SVG gutter redrawn in `requestAnimationFrame`. `DiffView.vue` keeps the inline view and delegates `layout === 'split'` to it, so the Changes and Log panes need only a height change. Syntax tokens and word marks move into a shared composable `useDiffDecor`.

**Tech Stack:** Vue 3 + Tailwind v4 + vue-i18n (apps/web), shiki tokens via `lib/highlight.ts`, plain `git` via `execGit` (apps/desktop), Vitest (happy-dom), CDP E2E.

**Spec:** User request 2026-10-15, item 2, with its design note "Thiết kế side-by-side diff kiểu JetBrains": no filler lines; Modified = blue both sides, Deleted = grey left + thin line right, Inserted = thin line left + green right; (1) line diff → `Fragment { l1Start, l1End, l2Start, l2End }` half-open, histogram/patience over Myers; (2) word/char diff inside modified fragments, darker tint; (3) SVG/canvas gutter redrawn on scroll via rAF, Bézier band per fragment, only visible ones, `>>` buttons at the fragment top; (4) non-linear scroll sync via `mapLine` + inverse, centre line, `syncing` flag cleared next frame; polish: collapse unchanged, F7/Shift+F7, ignore whitespace / blank lines, highlight lines/words/chars, live edit, apply/revert chunk. Prior rulings: `.planning/PLAN-v29-git-diff.md`, `.planning/COLOR-SYSTEM.md`. Siblings split from the same request: `2026-10-15-sidebar-width.md`, `2026-10-15-diff-arrow-files.md`, `2026-10-15-explorer-context-menu.md`, `2026-10-15-log-branches-toolbar.md`, `2026-10-15-attachments-removal.md`.

## Rulings (decided while planning — confirm or overrule before execution)

1. **Diff engine stays git** (v29). Layer 1 is the existing full-context `git diff` + `changeBlocks`; every `git diff` the app runs gains `--histogram`. No `diff` npm package.
2. **Read-only** (v29 owner ruling): no live editing of the right side, no `<<` (copying the working tree into HEAD is impossible), no "ignore chunk ×". The gutter `»` is the existing per-block revert (`git apply -R` behind `DiscardConfirm`), shown only in the Changes pane.
3. **Grey for deleted only in the split view.** Inline (unified) keeps red/green; Explorer and file-viewer gutters are unchanged.
4. Already in place from v29 and kept: collapse unchanged (now folds both sides at once), F7/Shift+F7, whitespace options (incl. "ignore whitespace and empty lines"). Added: highlight level Characters.
5. Rows have a fixed height (1.5em of the code font, measured), no soft wrap; each pane scrolls horizontally inside itself and the other side follows.

## Global Constraints

- All UI strings via vue-i18n, `en` and `vi` with key parity (the parity test in `apps/web/src/stores/workspace.test.ts` must stay green).
- All colours via theme tokens (`.planning/COLOR-SYSTEM.md`). The diff "well" is always dark: split colours derive from `--ccm-diff-mod-well`, `--ccm-diff-add-well`, `--ccm-well-ink`, `--ccm-well`, `--ccm-well-line`, `--ccm-focus` with `color-mix` — no new theme tokens. Change kind is never colour alone: the gutter shape (band / point on the empty side), the thin line and the line-number tooltip (`workspace.gutter.kind.*`) carry it too.
- No horizontal page scroll; the split panes scroll horizontally inside themselves.
- No new npm dependency.
- Storage: `ccm.workspace.diffOpts` gains `highlight` and migrates the old `words` boolean.
- Reduced motion: no animation is added (scroll sync is instant).
- Commits: gitmoji style, message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tests: `npm test -w @ccm/web -- <file>`, `npm test -w @ccm/desktop -- <file>`, `npm run typecheck`. E2E needs `npm run build -w @ccm/web && npm run build -w @ccm/desktop`, then `node apps/desktop/e2e/<name>.cjs`.
- After each task, add 1–2 lines per change to `.code_index/` (`web.md` / `desktop.md` / `_meta.md`); Task 7 does the final pass.

## Review Focus

1. **New / untracked file and deleted file** (one side has no lines) → one fragment, a thin line at row 0 on the empty side, connectors drawn, scroll sync holds the empty side still; no crash on an empty row list. Pinned in Task 2 (`splitModel` new-file test) and Task 3 (`mapRow` across an empty side).
2. **Huge file in `partial` mode** (several hunks with gaps) → a gap row at the same index on both sides, so rows stay aligned and `mapRow` stays a constant shift between fragments. Pinned in Task 2 (two-hunk test).
3. **Code zoom while the split view is open** (Ctrl/⌘ + wheel changes `--ccm-code-size`) → row height re-measured, connectors still meet the row tops. Pinned in Task 6 (E2E zoom check).
4. **"\ No newline at end of file"** inside a changed block → the note row goes to the side of the line it follows and the fragment covers it. Pinned in Task 2 (note test).
5. **Old stored option `{ words: false }`** → highlight level "Lines", not a crash or a silent switch back to words. Pinned in Task 5 (`readDiffOpts` migration test).

---

### Task 1: Histogram diff everywhere

**Files:**
- Modify: `apps/desktop/src/preview/changes.ts:78-81,247`
- Test: `apps/desktop/test/changes.test.ts:164`

**Interfaces:**
- Produces: `diffArgs(opts)` now starts with `'--histogram'`; consumed unchanged by `diff()` (changes.ts:286) and `commitDiff()` (log.ts:220).

- [ ] **Step 1: Write the failing test** — in `apps/desktop/test/changes.test.ts` replace line 164 with:

```ts
    expect(diffArgs({ whitespace: 'all-blank' })).toEqual(['--histogram', '-w', '--ignore-blank-lines'])
    expect(diffArgs({ context: 'full' })).toEqual(['--histogram', '-U1000000'])
```

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/changes.test.ts` — Expected: FAIL on the `diffArgs` expectation.

- [ ] **Step 3: Implement** — `changes.ts:78-81`:

```ts
/** `git diff` flags for the options (after `diff <base>`). Histogram, like IntelliJ: fewer `}` / blank-line mismatches than Myers. */
export function diffArgs(opts: DiffOptions = {}): string[] {
  const { context, whitespace } = cleanDiffOptions(opts)
  return ['--histogram', ...(context === 'full' ? [FULL_CONTEXT] : []), ...WHITESPACE_ARGS[whitespace]]
}
```

And the numstat call at line 247 (so `+N −M` counts match the viewer): `execGit(root, ['diff', base, '--histogram', '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv'], …)`. Grep the file for any other `['diff',` call that does not spread `diffArgs` and add `'--histogram'` after the base the same way.

- [ ] **Step 4: Run** `npm test -w @ccm/desktop` — Expected: PASS (all desktop tests; the revert/rollback tests prove patches still apply).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preview/changes.ts apps/desktop/test/changes.test.ts
git commit -m "⚡️ Use histogram git diff for the viewer, gutter and counts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Split model — rows per side + fragments

**Files:**
- Create: `apps/web/src/lib/splitDiff.ts`, `apps/web/src/lib/splitDiff.test.ts`

**Interfaces:**
- Consumes: `DiffFile`, `DiffLine` (`lib/diff.ts`); `Block`, `BlockType`, `changeBlocks`, `foldRows` (`lib/diffBlocks.ts`).
- Produces:

```ts
export type Side = 'left' | 'right'
export type SplitRow =
  | { kind: 'line'; line: DiffLine; block: number | null }
  | { kind: 'note'; text: string }
  | { kind: 'fold'; key: string; count: number }
  | { kind: 'gap' }
export interface Fragment { block: number; type: BlockType; l1Start: number; l1End: number; l2Start: number; l2End: number }
export interface SplitModel { left: SplitRow[]; right: SplitRow[]; frags: Fragment[] }
export interface SplitOpts { collapse: boolean; context: number; expanded: ReadonlySet<string> }
export function splitModel(file: DiffFile, blocks: readonly Block[], opts: SplitOpts): SplitModel
```

Row indices in `Fragment` are indices into `left` / `right` (after folding), half-open. Unchanged runs, folds and gaps always take the same number of rows on both sides — that is what makes `mapRow` a constant shift between fragments.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/splitDiff.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diff'
import { changeBlocks } from './diffBlocks'
import { splitModel, type SplitRow } from './splitDiff'

const file = (body: string, head = 'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n') => parseUnifiedDiff(head + body)[0]!
const text = (rows: SplitRow[]) => rows.map((r) => (r.kind === 'line' ? r.line.text : r.kind === 'fold' ? `fold:${r.count}` : r.kind === 'note' ? 'note' : 'gap'))
const flat = { collapse: false, context: 3, expanded: new Set<string>() }

// left: a b X c d D1 D2 e f g — right: a b Y1 Y2 c d e f I1 I2 g
const SAMPLE = '@@ -1,10 +1,11 @@\n a\n b\n-X\n+Y1\n+Y2\n c\n d\n-D1\n-D2\n e\n f\n+I1\n+I2\n g\n'

describe('splitModel', () => {
  it('keeps real lines on each side, no filler rows', () => {
    const f = file(SAMPLE)
    const m = splitModel(f, changeBlocks(f), flat)
    expect(text(m.left)).toEqual(['a', 'b', 'X', 'c', 'd', 'D1', 'D2', 'e', 'f', 'g'])
    expect(text(m.right)).toEqual(['a', 'b', 'Y1', 'Y2', 'c', 'd', 'e', 'f', 'I1', 'I2', 'g'])
  })

  it('turns blocks into fragments in row coordinates', () => {
    const f = file(SAMPLE)
    expect(splitModel(f, changeBlocks(f), flat).frags).toEqual([
      { block: 0, type: 'modified', l1Start: 2, l1End: 3, l2Start: 2, l2End: 4 },
      { block: 1, type: 'deleted', l1Start: 5, l1End: 7, l2Start: 6, l2End: 6 },
      { block: 2, type: 'added', l1Start: 9, l1End: 9, l2Start: 8, l2End: 10 },
    ])
  })

  it('tags changed rows with their block and unchanged rows with null', () => {
    const f = file(SAMPLE)
    const m = splitModel(f, changeBlocks(f), flat)
    expect(m.left.map((r) => (r.kind === 'line' ? r.block : 'x'))).toEqual([null, null, 0, null, null, 1, 1, null, null, null])
  })

  it('folds unchanged runs on both sides at once and opens an expanded fold', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `L${i + 1}`)
    const body = `@@ -1,20 +1,20 @@\n${lines.map((l, i) => (i === 9 ? `-${l}\n+X` : ` ${l}`)).join('\n')}\n`
    const f = file(body)
    const m = splitModel(f, changeBlocks(f), { collapse: true, context: 2, expanded: new Set() })
    expect(text(m.left)).toEqual(['fold:7', 'L8', 'L9', 'L10', 'L11', 'L12', 'fold:8'])
    expect(text(m.right)).toEqual(['fold:7', 'L8', 'L9', 'X', 'L11', 'L12', 'fold:8'])
    expect(m.left[0]).toMatchObject({ kind: 'fold', key: '0:0' })
    expect(m.frags[0]).toMatchObject({ l1Start: 3, l1End: 4, l2Start: 3, l2End: 4 })
    const open = splitModel(f, changeBlocks(f), { collapse: true, context: 2, expanded: new Set(['0:0']) })
    expect(open.left.length).toBe(13)
    expect(open.frags[0]!.l1Start).toBe(9)
  })

  it('puts a "No newline" note on the side of the line it follows', () => {
    const f = file('@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n')
    const m = splitModel(f, changeBlocks(f), flat)
    expect(text(m.left)).toEqual(['a', 'b', 'note'])
    expect(text(m.right)).toEqual(['a', 'b'])
    expect(m.frags[0]).toMatchObject({ l1Start: 1, l1End: 3, l2Start: 1, l2End: 2 })
  })

  it('keeps both sides aligned across hunk gaps (partial diff)', () => {
    const f = file('@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -10,2 +10,2 @@\n j\n-k\n+K\n')
    const m = splitModel(f, changeBlocks(f), flat)
    expect(text(m.left)).toEqual(['a', 'b', 'gap', 'j', 'k'])
    expect(text(m.right)).toEqual(['A', 'b', 'gap', 'j', 'K'])
    expect(m.frags.map((x) => [x.l1Start, x.l2Start])).toEqual([[0, 0], [4, 4]])
  })

  it('handles a new file: empty left side, one added fragment', () => {
    const f = parseUnifiedDiff('diff --git a/n.md b/n.md\nnew file mode 100644\n--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+x\n+y\n')[0]!
    const m = splitModel(f, changeBlocks(f), flat)
    expect(m.left).toEqual([])
    expect(text(m.right)).toEqual(['x', 'y'])
    expect(m.frags).toEqual([{ block: 0, type: 'added', l1Start: 0, l1End: 0, l2Start: 0, l2End: 2 }])
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/splitDiff.test.ts` — Expected: FAIL (`Failed to resolve import "./splitDiff"`).

- [ ] **Step 3: Implement** — `apps/web/src/lib/splitDiff.ts`

```ts
import type { DiffFile, DiffLine } from './diff'
import { foldRows, type Block, type BlockType } from './diffBlocks'

export type Side = 'left' | 'right'

export type SplitRow =
  | { kind: 'line'; line: DiffLine; block: number | null }
  | { kind: 'note'; text: string }
  | { kind: 'fold'; key: string; count: number }
  | { kind: 'gap' }

/** One change block as row ranges `[start, end)` on each side (JetBrains `Fragment`); an empty side = Inserted / Deleted. */
export interface Fragment {
  block: number
  type: BlockType
  l1Start: number
  l1End: number
  l2Start: number
  l2End: number
}

export interface SplitModel {
  left: SplitRow[]
  right: SplitRow[]
  frags: Fragment[]
}

export interface SplitOpts {
  collapse: boolean
  context: number
  /** `${hunk}:${unitFrom}` of folds the user opened. */
  expanded: ReadonlySet<string>
}

type Unit = { kind: 'ctx'; line: DiffLine; notes: string[] } | { kind: 'block'; index: number }

/**
 * Side-by-side rows without filler lines: each side holds only its own lines; unchanged runs, folds and hunk gaps
 * take one row per line on both sides, so the two sides differ only inside fragments.
 */
export function splitModel(file: DiffFile, blocks: readonly Block[], opts: SplitOpts): SplitModel {
  const left: SplitRow[] = []
  const right: SplitRow[] = []
  const frags: Fragment[] = []
  const startOf = new Map(blocks.map((b, i) => [`${b.hunk}:${b.from}`, i]))

  file.hunks.forEach((h, hi) => {
    if (hi > 0) {
      left.push({ kind: 'gap' })
      right.push({ kind: 'gap' })
    }
    const units: Unit[] = []
    for (let i = 0; i < h.lines.length; ) {
      const bi = startOf.get(`${hi}:${i}`)
      if (bi !== undefined) {
        units.push({ kind: 'block', index: bi })
        i = blocks[bi]!.to
        continue
      }
      const l = h.lines[i]!
      if (l.type === 'note') {
        const last = units[units.length - 1]
        if (last?.kind === 'ctx') last.notes.push(l.text)
      } else units.push({ kind: 'ctx', line: l, notes: [] })
      i++
    }

    const changed = units.map((u) => u.kind === 'block')
    const open = new Set([...opts.expanded].filter((k) => k.startsWith(`${hi}:`)).map((k) => Number(k.slice(k.indexOf(':') + 1))))
    const segments = opts.collapse ? foldRows(changed, opts.context, open) : [{ kind: 'rows' as const, from: 0, to: units.length }]

    for (const seg of segments) {
      if (seg.kind === 'fold') {
        const row: SplitRow = { kind: 'fold', key: `${hi}:${seg.from}`, count: seg.to - seg.from }
        left.push(row)
        right.push(row)
        continue
      }
      for (let u = seg.from; u < seg.to; u++) {
        const unit = units[u]!
        if (unit.kind === 'ctx') {
          left.push({ kind: 'line', line: unit.line, block: null })
          right.push({ kind: 'line', line: unit.line, block: null })
          for (const text of unit.notes) {
            left.push({ kind: 'note', text })
            right.push({ kind: 'note', text })
          }
          continue
        }
        const b = blocks[unit.index]!
        const l1Start = left.length
        const l2Start = right.length
        let prev: DiffLine | null = null
        for (const l of h.lines.slice(b.from, b.to)) {
          if (l.type === 'del') left.push({ kind: 'line', line: l, block: unit.index })
          else if (l.type === 'add') right.push({ kind: 'line', line: l, block: unit.index })
          else if (l.type === 'note' && prev) (prev.type === 'del' ? left : right).push({ kind: 'note', text: l.text })
          if (l.type !== 'note') prev = l
        }
        frags.push({ block: unit.index, type: b.type, l1Start, l1End: left.length, l2Start, l2End: right.length })
      }
    }
  })
  return { left, right, frags }
}
```

- [ ] **Step 4: Run** `npm test -w @ccm/web -- src/lib/splitDiff.test.ts` — Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/splitDiff.ts apps/web/src/lib/splitDiff.test.ts
git commit -m "✨ Add the JetBrains split diff model (rows per side + fragments)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Split geometry — scroll mapping and connectors

**Files:**
- Modify: `apps/web/src/lib/splitDiff.ts` (append), `apps/web/src/lib/splitDiff.test.ts` (append)

**Interfaces:**
- Produces:

```ts
export function mapRow(row: number, frags: readonly Fragment[], from: Side): number
export function connectorPath(f: Fragment, lh: number, top1: number, top2: number, w: number): string
export function visibleFragments(frags: readonly Fragment[], lh: number, top1: number, top2: number, height: number): Fragment[]
export function midRow(scrollTop: number, clientHeight: number, lh: number): number
export function scrollTopFor(row: number, lh: number, clientHeight: number): number
```

- [ ] **Step 1: Write the failing tests** — append to `splitDiff.test.ts`:

```ts
import { connectorPath, mapRow, midRow, scrollTopFor, visibleFragments, type Fragment } from './splitDiff'

const FR: Fragment[] = [
  { block: 0, type: 'modified', l1Start: 2, l1End: 3, l2Start: 2, l2End: 4 },
  { block: 1, type: 'deleted', l1Start: 5, l1End: 7, l2Start: 6, l2End: 6 },
  { block: 2, type: 'added', l1Start: 9, l1End: 9, l2Start: 8, l2End: 10 },
]

describe('mapRow', () => {
  it('shifts unchanged rows by a constant', () => {
    expect(mapRow(1.5, FR, 'left')).toBe(1.5)
    expect(mapRow(3, FR, 'left')).toBe(4)
    expect(mapRow(7, FR, 'left')).toBe(6)
    expect(mapRow(9, FR, 'left')).toBe(10)
  })
  it('interpolates inside a fragment', () => {
    expect(mapRow(2.5, FR, 'left')).toBe(3)
    expect(mapRow(3, FR, 'right')).toBe(2.5)
  })
  it('holds the other side still across an empty side', () => {
    expect(mapRow(5, FR, 'left')).toBe(6)
    expect(mapRow(6.5, FR, 'left')).toBe(6)
    expect(mapRow(9, FR, 'right')).toBe(9)
  })
  it('is the identity with no fragments', () => {
    expect(mapRow(42, [], 'right')).toBe(42)
  })
})

describe('connector geometry', () => {
  it('draws a closed Bézier band between the two row ranges', () => {
    expect(connectorPath(FR[0]!, 20, 0, 0, 40)).toBe('M0 40 C20 40 20 40 40 40 L40 80 C20 80 20 60 0 60 Z')
  })
  it('collapses to a point on an empty side (deleted)', () => {
    expect(connectorPath(FR[1]!, 10, 0, 0, 40)).toBe('M0 50 C20 50 20 60 40 60 L40 60 C20 60 20 70 0 70 Z')
  })
  it('keeps fragments visible on either side only', () => {
    expect(visibleFragments(FR, 10, 0, 0, 40).map((f) => f.block)).toEqual([0])
    expect(visibleFragments(FR, 10, 50, 0, 35).map((f) => f.block)).toEqual([0, 1])
    expect(visibleFragments(FR, 10, 1000, 1000, 40)).toEqual([])
  })
  it('centres a row in the viewport and reads the centre row back', () => {
    expect(scrollTopFor(10, 20, 100)).toBe(150)
    expect(scrollTopFor(1, 20, 100)).toBe(0)
    expect(midRow(150, 100, 20)).toBe(10)
  })
})
```

(The `import` line goes at the top next to the existing one: `import { connectorPath, mapRow, midRow, scrollTopFor, splitModel, visibleFragments, type Fragment, type SplitRow } from './splitDiff'`.)

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/splitDiff.test.ts` — Expected: FAIL (`mapRow is not a function` etc.).

- [ ] **Step 3: Implement** — append to `splitDiff.ts`:

```ts
/** Row on the other side matching `row` (fractional) on `from`: a constant shift between fragments, linear inside one. */
export function mapRow(row: number, frags: readonly Fragment[], from: Side): number {
  let offset = 0
  for (const f of frags) {
    const [aS, aE, bS, bE] = from === 'left' ? [f.l1Start, f.l1End, f.l2Start, f.l2End] : [f.l2Start, f.l2End, f.l1Start, f.l1End]
    if (row < aS) break
    if (row < aE) return bS + ((row - aS) / (aE - aS)) * (bE - bS)
    offset = bE - aE
  }
  return row + offset
}

/** Gutter band of `f`: left edge at the left rows, right edge at the right rows, Bézier top and bottom. */
export function connectorPath(f: Fragment, lh: number, top1: number, top2: number, w: number): string {
  const y1a = f.l1Start * lh - top1
  const y1b = f.l1End * lh - top1
  const y2a = f.l2Start * lh - top2
  const y2b = f.l2End * lh - top2
  const m = w / 2
  return `M0 ${y1a} C${m} ${y1a} ${m} ${y2a} ${w} ${y2a} L${w} ${y2b} C${m} ${y2b} ${m} ${y1b} 0 ${y1b} Z`
}

/** Fragments touching the viewport (`height` px) of at least one side. */
export function visibleFragments(frags: readonly Fragment[], lh: number, top1: number, top2: number, height: number): Fragment[] {
  const on = (start: number, end: number, top: number): boolean => end * lh - top >= 0 && start * lh - top <= height
  return frags.filter((f) => on(f.l1Start, f.l1End, top1) || on(f.l2Start, f.l2End, top2))
}

/** Fractional row at the vertical centre of a pane. */
export const midRow = (scrollTop: number, clientHeight: number, lh: number): number => (scrollTop + clientHeight / 2) / lh

/** scrollTop that puts `row` at the vertical centre (never negative). */
export const scrollTopFor = (row: number, lh: number, clientHeight: number): number => Math.max(0, row * lh - clientHeight / 2)
```

- [ ] **Step 4: Run** `npm test -w @ccm/web -- src/lib/splitDiff.test.ts` — Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/splitDiff.ts apps/web/src/lib/splitDiff.test.ts
git commit -m "✨ Add split diff scroll mapping and gutter connector geometry

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Extract syntax + word marks into `useDiffDecor`

Pure refactor, no behaviour change: the inline view and the coming split view share tokenizing and word marks.

**Files:**
- Create: `apps/web/src/composables/useDiffDecor.ts`
- Modify: `apps/web/src/components/workspace/DiffView.vue:1-93`

**Interfaces:**
- Produces:

```ts
export interface DiffDecorSource { file: () => DiffFile; blocks: () => readonly Block[]; lang: () => string | null; words: () => boolean }
export function useDiffDecor(src: DiffDecorSource): {
  lineInfo: ComputedRef<{ block: Map<DiffLine, number>; marks: Map<DiffLine, WordMark[]> }>
  code: (l: DiffLine | undefined, cls: string) => string
}
```

(Task 5 replaces `words: () => boolean` with `highlight: () => DiffHighlight`.)

- [ ] **Step 1: Create** `apps/web/src/composables/useDiffDecor.ts`

```ts
import { computed, shallowRef, watch } from 'vue'
import { renderLine, type CodeToken } from '../lib/codeView'
import type { DiffFile, DiffLine } from '../lib/diff'
import { wordDiff, type Block, type WordMark } from '../lib/diffBlocks'
import { tokenize } from '../lib/highlight'

export interface DiffDecorSource {
  file: () => DiffFile
  blocks: () => readonly Block[]
  /** shiki grammar id, null = plain. */
  lang: () => string | null
  words: () => boolean
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
    src.blocks().forEach((b, i) => {
      for (const l of b.dels) block.set(l, i)
      for (const l of b.adds) block.set(l, i)
      if (!src.words() || b.type !== 'modified') return
      const res = wordDiff(b.dels.map((l) => l.text), b.adds.map((l) => l.text))
      if (!res) return
      b.dels.forEach((l, k) => res.old[k]!.length && marks.set(l, res.old[k]!))
      b.adds.forEach((l, k) => res.new[k]!.length && marks.set(l, res.new[k]!))
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
```

- [ ] **Step 2: Use it in `DiffView.vue`** — delete lines 28 (`tokens`), 32-81 (`seq`, `highlight`, both watches on file/lang except the `expanded` reset, `lineInfo`) and 88-93 (`code`), keep the `expanded` reset watch, and add:

```ts
import { useDiffDecor } from '../../composables/useDiffDecor'
// …
const { lineInfo, code: decorCode } = useDiffDecor({ file: () => props.file, blocks: () => props.blocks, lang: () => props.lang, words: () => props.words })
const code = (l: DiffLine | undefined): string => decorCode(l, l?.type === 'add' ? 'w-add' : 'w-del')
```

Remove now-unused imports (`shallowRef`, `renderLine`, `CodeToken`, `wordDiff`, `WordMark`, `tokenize`).

- [ ] **Step 3: Verify** — Run: `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/diff.cjs`
Expected: typecheck clean, unit PASS, `diff.cjs` all PASS (same 22 checks as before — word marks, folds, split revert).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/composables/useDiffDecor.ts apps/web/src/components/workspace/DiffView.vue
git commit -m "♻️ Share diff syntax tokens and word marks through useDiffDecor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Highlight level — lines / words / characters

**Files:**
- Modify: `apps/web/src/lib/diffBlocks.ts:112-176`, `apps/web/src/lib/diffBlocks.test.ts` (append), `apps/web/src/lib/diffOpts.ts`, `apps/web/src/composables/useDiffDecor.ts`, `apps/web/src/components/workspace/DiffView.vue:9-23`, `ChangesPane.vue:622-636,817`, `log/LogPane.vue:328`, `apps/web/src/i18n/workspace-diff.ts` (`hl`)
- Create: `apps/web/src/lib/diffOpts.test.ts`

**Interfaces:**
- Produces: `wordDiff(oldLines, newLines, mode: 'words' | 'chars' = 'words')`; `export type DiffHighlight = 'lines' | 'words' | 'chars'`; `export const HIGHLIGHTS: DiffHighlight[] = ['words', 'chars', 'lines']`; `DiffOpts.highlight: DiffHighlight` (replaces `words`); `DiffDecorSource.highlight: () => DiffHighlight` (replaces `words`); `DiffView` prop `highlight: DiffHighlight` (replaces `words`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/diffBlocks.test.ts`:

```ts
describe('wordDiff modes', () => {
  it('marks whole words in words mode', () => {
    expect(wordDiff(['color'], ['colour'])).toEqual({ old: [[{ start: 0, end: 5 }]], new: [[{ start: 0, end: 6 }]] })
  })
  it('marks single characters in chars mode', () => {
    expect(wordDiff(['color'], ['colour'], 'chars')).toEqual({ old: [[]], new: [[{ start: 4, end: 5 }]] })
  })
})
```

(`wordDiff` is already imported in that file; if not, add it to the import from `./diffBlocks`.)

Create `apps/web/src/lib/diffOpts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { DIFF_OPTS_KEY, readDiffOpts } from './diffOpts'

describe('readDiffOpts highlight', () => {
  beforeEach(() => localStorage.clear())
  it('defaults to words', () => expect(readDiffOpts().highlight).toBe('words'))
  it('migrates the old words:false to lines', () => {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ words: false }))
    expect(readDiffOpts().highlight).toBe('lines')
  })
  it('keeps a stored level and rejects junk', () => {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ highlight: 'chars' }))
    expect(readDiffOpts().highlight).toBe('chars')
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ highlight: 'bytes' }))
    expect(readDiffOpts().highlight).toBe('words')
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/diffBlocks.test.ts src/lib/diffOpts.test.ts` — Expected: FAIL (chars test marks the whole word; `highlight` undefined).

- [ ] **Step 3: Implement**

`diffBlocks.ts` — replace `const TOKEN = …` and the `wordDiff` signature/tokenizer:

```ts
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
  // …rest of the function unchanged…
```

`diffOpts.ts` — full new version:

```ts
import type { DiffWhitespace } from './preview'

/** IntelliJ "Highlight": changed lines only, or also the changed words / characters inside Modified blocks. */
export type DiffHighlight = 'lines' | 'words' | 'chars'

export interface DiffOpts {
  layout: 'inline' | 'split'
  collapse: boolean
  context: number
  whitespace: DiffWhitespace
  highlight: DiffHighlight
}

export const DIFF_OPTS_KEY = 'ccm.workspace.diffOpts'
const OLD_LAYOUT_KEY = 'ccm.workspace.diffLayout'
export const CONTEXTS = [3, 5, 10]
export const WHITESPACE: DiffWhitespace[] = ['none', 'eol', 'all', 'all-blank']
export const HIGHLIGHTS: DiffHighlight[] = ['words', 'chars', 'lines']

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Shared by the Changes and Log diff viewers. */
export function readDiffOpts(): DiffOpts {
  const base: DiffOpts = { layout: read(OLD_LAYOUT_KEY) === 'split' ? 'split' : 'inline', collapse: true, context: 3, whitespace: 'none', highlight: 'words' }
  try {
    const raw = JSON.parse(read(DIFF_OPTS_KEY) ?? 'null') as (Partial<DiffOpts> & { words?: unknown }) | null
    if (!raw || typeof raw !== 'object') return base
    return {
      layout: raw.layout === 'split' ? 'split' : raw.layout === 'inline' ? 'inline' : base.layout,
      collapse: typeof raw.collapse === 'boolean' ? raw.collapse : base.collapse,
      context: CONTEXTS.includes(raw.context as number) ? (raw.context as number) : base.context,
      whitespace: WHITESPACE.includes(raw.whitespace as DiffWhitespace) ? (raw.whitespace as DiffWhitespace) : base.whitespace,
      // `words: boolean` became `highlight` (split diff plan).
      highlight: HIGHLIGHTS.includes(raw.highlight as DiffHighlight) ? (raw.highlight as DiffHighlight) : raw.words === false ? 'lines' : base.highlight,
    }
  } catch {
    return base
  }
}

export function writeDiffOpts(o: DiffOpts): void {
  try {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify(o))
  } catch {
    // private mode / quota: options last for this session only
  }
}
```

`useDiffDecor.ts` — `words: () => boolean` → `highlight: () => DiffHighlight` (import type from `../lib/diffOpts`), and in `lineInfo`:

```ts
    const mode = src.highlight()
    src.blocks().forEach((b, i) => {
      for (const l of b.dels) block.set(l, i)
      for (const l of b.adds) block.set(l, i)
      if (mode === 'lines' || b.type !== 'modified') return
      const res = wordDiff(b.dels.map((l) => l.text), b.adds.map((l) => l.text), mode)
```

`DiffView.vue` — prop `words: boolean` → `highlight: DiffHighlight` (doc comment: `/** IntelliJ "Highlight": lines / words / characters inside Modified blocks. */`), decor source `highlight: () => props.highlight`.

`ChangesPane.vue` — import `HIGHLIGHTS` from `../../lib/diffOpts`; replace the highlight group (lines 623-636):

```vue
            <div role="group" :aria-label="t('workspace.diff.highlight')">
              <button v-for="h in HIGHLIGHTS" :key="h" type="button" role="menuitemradio" :aria-checked="opts.highlight === h" :class="MENU_ROW" :data-hl="h" @click="setOpt('highlight', h)">
                <Check :size="13" class="shrink-0" :class="opts.highlight === h ? '' : 'invisible'" aria-hidden="true" />
                {{ t(`workspace.diff.hl.${h}`) }}
              </button>
            </div>
```

and `:words="opts.words"` → `:highlight="opts.highlight"` (line 817). `LogPane.vue:328` the same.

i18n `workspace-diff.ts`: en `hl: { words: 'Words', chars: 'Characters', lines: 'Lines' }`, vi `hl: { words: 'Theo từ', chars: 'Theo ký tự', lines: 'Theo dòng' }`.

- [ ] **Step 4: Run** `npm run typecheck && npm test -w @ccm/web` — Expected: clean; PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/diffBlocks.ts apps/web/src/lib/diffBlocks.test.ts apps/web/src/lib/diffOpts.ts apps/web/src/lib/diffOpts.test.ts apps/web/src/composables/useDiffDecor.ts apps/web/src/components/workspace/DiffView.vue apps/web/src/components/workspace/ChangesPane.vue apps/web/src/components/workspace/log/LogPane.vue apps/web/src/i18n/workspace-diff.ts
git commit -m "✨ Diff highlight level: lines, words or characters

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: `SplitDiff.vue` — two panes, curved gutter, scroll sync, revert

**Files:**
- Create: `apps/web/src/components/workspace/SplitDiff.vue`
- Modify: `apps/web/src/components/workspace/DiffView.vue` (template, `scrollToBlock`, drop split code and `.is-split` CSS), `ChangesPane.vue:792,808-823`, `log/LogPane.vue:314,319-332`, `apps/web/src/lib/diff.ts:168-196` (drop `SideRow`/`sideBySide`), `apps/web/src/lib/reviewTools.test.ts:83-93`, `apps/web/src/i18n/workspace-diff.ts`, `apps/desktop/e2e/run.cjs:8`
- Create (E2E): `apps/desktop/e2e/split-diff.cjs`

**Interfaces:**
- Consumes: Task 2/3 `splitModel`, `mapRow`, `connectorPath`, `visibleFragments`, `midRow`, `scrollTopFor`, `Side`, `SplitRow`, `Fragment`; Task 4/5 `useDiffDecor`, `DiffHighlight`.
- Produces: `SplitDiff` props `{ file; blocks; lang; collapse; context; highlight; canRevert; revertBlocked?; current; sides: { left: string; right: string } }`, emits `revert(i)`, `focusBlock(i)`, expose `scrollToBlock(i): Promise<void>`. `DiffView` gains prop `sides?: { left: string; right: string }`. DOM hooks: root `.is-split[data-split-diff]`, panes `[data-side=left|right]`, rows `.sd-row[data-block]`, thin marks `.sd-mark`, connectors `path.sd-conn`, revert `.rv[data-revert]`, folds `[data-fold]`.

- [ ] **Step 1: Create** `apps/web/src/components/workspace/SplitDiff.vue`

```vue
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
  ro = new ResizeObserver(measure)
  if (probe.value) ro.observe(probe.value)
  if (leftEl.value) ro.observe(leftEl.value)
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
  for (const x of r.querySelectorAll('.is-current')) x.classList.remove('is-current')
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
/* Always on the dark well. JetBrains colours: modified blue, inserted green, deleted grey (a neutral well-ink step, not red). */
.is-split {
  --mod-ink: var(--ccm-diff-mod-well);
  --add-ink: var(--ccm-diff-add-well);
  --del-ink: color-mix(in srgb, var(--ccm-well-ink) 72%, var(--ccm-well));
  --mod-bg: color-mix(in srgb, var(--mod-ink) 16%, transparent);
  --add-bg: color-mix(in srgb, var(--add-ink) 14%, transparent);
  --del-bg: color-mix(in srgb, var(--del-ink) 18%, transparent);
  --mod-word: color-mix(in srgb, var(--mod-ink) 40%, transparent);
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
  color: color-mix(in srgb, var(--ccm-well-ink) 50%, var(--ccm-well));
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
  color: var(--ccm-syn-comment, #7f8c98);
  user-select: none;
}
.is-split :deep(.sd-row.fold) {
  background: color-mix(in srgb, var(--ccm-well-ink) 4%, var(--ccm-well));
  box-shadow: inset 0 1px 0 var(--ccm-well-line), inset 0 -1px 0 var(--ccm-well-line);
}
.is-split :deep(.sd-row.fold button) {
  text-align: left;
  color: var(--ccm-syn-comment, #7f8c98);
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
  background: var(--ccm-well-selection, #3f638b);
}
</style>
```

- [ ] **Step 2: `DiffView.vue` becomes inline + delegate**

- Add prop `sides?: { left: string; right: string }` (doc: `/** Split view column headers (default HEAD / working tree). */`).
- Delete `splitRows`, the `CHEVRONS` constant, the `split` branch in `html` (render always uses `inlineRows`; `foldHtml(…, 'r')`), and every `.is-split …` rule in `<style>`; remove `sideBySide` from the `lib/diff` import.
- Import `SplitDiff` and add `const split = ref<InstanceType<typeof SplitDiff> | null>(null)`.
- `scrollToBlock`:

```ts
async function scrollToBlock(i: number): Promise<void> {
  if (props.layout === 'split') return split.value?.scrollToBlock(i)
  await nextTick()
  markCurrent()
  root.value?.querySelector<HTMLElement>(`[data-block="${i}"]`)?.scrollIntoView({ block: 'center' })
}
```

- Template:

```vue
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
    @revert="(i) => emit('revert', i)"
    @focus-block="(i) => emit('focusBlock', i)"
  />
  <div
    v-else
    ref="root"
    class="diff ccm-code w-max min-w-full py-1"
    role="document"
    data-code-zoom
    :aria-label="blocks.length ? t('workspace.diff.change', { n: current + 1, total: blocks.length }) : undefined"
    @click="onClick"
    v-html="html"
  />
</template>
```

- The `watch([html, () => props.current], …)` and `markCurrent` stay for inline.

- [ ] **Step 3: Hosts give the split view the full height**

`ChangesPane.vue:792` — `<div class="ccm-scroll min-h-0 flex-1 overflow-auto">` →

```vue
        <div class="ccm-scroll min-h-0 flex-1" :class="opts.layout === 'split' && diffFile && diffState === 'idle' ? 'overflow-hidden' : 'overflow-auto'">
```

`LogPane.vue:314` — same change on `<div class="ccm-scroll min-h-0 flex-1 overflow-auto bg-well">` (keep `bg-well`), and pass headers on the `DiffView` (line 319): `:sides="{ left: `${shortHash}^`, right: shortHash }"`.

- [ ] **Step 4: Drop the GitHub-style pairing** — delete `SideRow` + `sideBySide` from `apps/web/src/lib/diff.ts` (lines 168-196), and in `apps/web/src/lib/reviewTools.test.ts` remove `sideBySide` from the import and replace the test at lines 83-93 by:

```ts
  it('finds the first changed line', () => {
    expect(firstChangedLine(files[0]!)).toBe(2)
    expect(firstChangedLine(files[2]!)).toBe(1)
  })
```

- [ ] **Step 5: i18n** — `workspace-diff.ts` `diff`: en `side: { working: 'Working tree' },`, vi `side: { working: 'Bản đang sửa' },`.

- [ ] **Step 6: E2E** — create `apps/desktop/e2e/split-diff.cjs` and add `'split-diff'` to the end of the list in `apps/desktop/e2e/run.cjs:8`:

```js
// JetBrains side-by-side diff: real lines per side, thin lines for empty sides, word marks, scroll sync, F7, zoom.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-split-')))
const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, stdio: 'ignore' })
const base = Array.from({ length: 400 }, (_, i) => `const line${i + 1} = ${i + 1}`)

function fixture() {
  fs.mkdirSync(path.join(DIR, 'src'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'src', 'long.ts'), base.join('\n') + '\n')
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  // long.ts: line 5 modified, 6 lines inserted after 150, lines 300-309 deleted.
  const now = [...base]
  now[4] = 'const line5 = 500'
  now.splice(299, 10)
  now.splice(150, 0, ...Array.from({ length: 6 }, (_, i) => `const added${i} = ${i}`))
  fs.writeFileSync(path.join(DIR, 'src', 'long.ts'), now.join('\n') + '\n')
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
  await evaluate(`localStorage.setItem('ccm.workspace.diffOpts', JSON.stringify({ layout: 'split', collapse: false, context: 3, whitespace: 'none', highlight: 'words' }))`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(800)
  await evaluate(`${W}.openChanges(${JSON.stringify(DIR)}, { select: ${JSON.stringify(path.join(DIR, 'src', 'long.ts'))} })`)
  await waitFor(`!!document.querySelector('[data-kind=changes] [data-split-diff] path.sd-conn')`, 10000, 'split view').catch(() => {})
  await shot('split-diff-01')
  const counts = await evaluate(`[...document.querySelectorAll('[data-kind=changes] [data-side]')].map((p) => p.querySelectorAll('.sd-row').length)`)
  check('no filler rows: left 400 lines, right 396', JSON.stringify(counts) === JSON.stringify([400, 396]), JSON.stringify(counts))
  check('modified rows are tinted on both sides', await evaluate(`document.querySelectorAll('[data-kind=changes] .sd-row.modified').length === 2`))
  check('inserted block: thin line on the left, deleted block: thin line on the right', await evaluate(`!!document.querySelector('[data-kind=changes] [data-side=left] .sd-mark.added') && !!document.querySelector('[data-kind=changes] [data-side=right] .sd-mark.deleted')`))
  check('changed character marked inside the modified line', await evaluate(`!!document.querySelector('[data-kind=changes] [data-side=right] mark.w-mod')`))
  // Scroll sync: scroll the left pane to row 320 (after the inserted 6 and deleted 10 lines the right pane is 4 rows behind).
  const sync = await evaluate(`(async () => {
    const [l, r] = [...document.querySelectorAll('[data-kind=changes] [data-side]')]
    const lh = l.querySelector('.sd-row').getBoundingClientRect().height
    l.scrollTop = 320 * lh - l.clientHeight / 2
    await new Promise((res) => setTimeout(res, 300))
    return { left: (l.scrollTop + l.clientHeight / 2) / lh, right: (r.scrollTop + r.clientHeight / 2) / lh }
  })()`)
  check('scroll sync maps the centre row across fragments', Math.abs(sync.right - (sync.left - 4)) < 0.6, JSON.stringify(sync))
  // F7 lands on the next change and draws its connector as current.
  await evaluate(`document.querySelector('[data-kind=changes] [data-side=right]').focus()`)
  await evaluate(`document.querySelector('[data-kind=changes] [data-side=right]').dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true }))`)
  await sleep(300)
  check('F7 → change 2 of 3 with a current connector', /2\D+3/.test(await evaluate(`document.querySelector('[data-diff-position]').textContent`)) && (await evaluate(`!!document.querySelector('[data-kind=changes] path.sd-conn.is-current')`)))
  // Review focus 3: zoom keeps connectors on the rows.
  await evaluate(`document.documentElement.style.setProperty('--ccm-code-size', '18px')`)
  await sleep(400)
  const aligned = await evaluate(`(() => {
    const row = document.querySelector('[data-kind=changes] [data-side=left] .sd-row.is-current, [data-kind=changes] [data-side=left] .sd-mark.is-current')
    const pane = row.closest('[data-side]')
    const d = document.querySelector('[data-kind=changes] path.sd-conn.is-current').getAttribute('d')
    const y = Number(/^M0 (-?[\\d.]+)/.exec(d)[1])
    return Math.abs(y - (row.getBoundingClientRect().top - pane.getBoundingClientRect().top))
  })()`)
  check('connectors stay on their rows after zoom', aligned < 1.5, String(aligned))
  await evaluate(`document.documentElement.style.removeProperty('--ccm-code-size')`)
  await shot('split-diff-02-current')
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('split-diff-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-split-diff.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
```

`apps/desktop/e2e/diff.cjs` needs no change: its "split revert restores line 3" check clicks `.is-split .rv`, which the gutter `»` keeps.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/diff.cjs && node apps/desktop/e2e/log.cjs && node apps/desktop/e2e/split-diff.cjs`
Expected: all PASS (diff.cjs "split revert restores line 3" exercises the gutter `»`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/workspace/SplitDiff.vue apps/web/src/components/workspace/DiffView.vue apps/web/src/components/workspace/ChangesPane.vue apps/web/src/components/workspace/log/LogPane.vue apps/web/src/lib/diff.ts apps/web/src/lib/reviewTools.test.ts apps/web/src/i18n/workspace-diff.ts apps/desktop/e2e/split-diff.cjs apps/desktop/e2e/run.cjs
git commit -m "✨ Android Studio style side-by-side diff: real lines, curved gutter, synced scroll

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


### Task 7: Index, plan note, version

**Files:**
- Create: `.planning/PLAN-v33-split-diff.md`
- Modify: `.code_index/web.md`, `.code_index/desktop.md`, `.code_index/_meta.md`, `.planning/PLAN-v29-git-diff.md` (one line), `apps/desktop/package.json`

- [ ] **Step 1:** `.planning/PLAN-v33-split-diff.md` — 12–18 lines in the v29/v30 style: Goal, pieces (`--histogram`, `lib/splitDiff.ts`, `useDiffDecor`, `DiffOpts.highlight`, `SplitDiff.vue`, `DiffView` delegate, host height), the 5 Rulings above, Out of scope (live edit, `<<`, ignore chunk, soft wrap in split), tests (`splitDiff.test.ts`, `diffOpts.test.ts`, `diffBlocks.test.ts` modes, `changes.test.ts` args, `e2e/split-diff.cjs`, `diff.cjs`), link to this plan.
- [ ] **Step 2:** `.planning/PLAN-v29-git-diff.md` — under Pieces add: `- v33 (2026-10-15): split view rebuilt JetBrains style (no filler rows, curved gutter, synced scroll); see PLAN-v33-split-diff.md.`
- [ ] **Step 3:** `.code_index/web.md` — in the v29 section mark "split » middle column" and `sideBySide` as superseded and add a `## v33 split diff` block: `lib/splitDiff.ts` (`splitModel` rows per side + `Fragment`, `mapRow`, `connectorPath`, `visibleFragments`, `midRow`, `scrollTopFor`), `composables/useDiffDecor.ts` (tokens + word marks, `code(l, cls)`), `DiffOpts.highlight` lines/words/chars (migrates `words`), `SplitDiff.vue` (probe-measured row height, rAF gutter, `syncing` flag, `»` revert in the gutter, `[data-split-diff]`, `[data-side]`), `DiffView` inline + delegate. `desktop.md`: `diffArgs` starts with `--histogram`, numstat too. `_meta.md`: one line with the paths.
- [ ] **Step 4:** bump `apps/desktop/package.json` `version` one minor above `master`'s at merge time.
- [ ] **Step 5: Verify** — `npm run typecheck && npm test && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/diff.cjs && node apps/desktop/e2e/log.cjs && node apps/desktop/e2e/split-diff.cjs` — Expected: all PASS.
- [ ] **Step 6: Commit**

```bash
git add .planning/PLAN-v33-split-diff.md .planning/PLAN-v29-git-diff.md .code_index apps/desktop/package.json
git commit -m "📝 Split diff plan note, code index and version

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
