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
