import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diff'
import { changeBlocks } from './diffBlocks'
import { connectorPath, mapRow, midRow, scrollTopFor, splitModel, visibleFragments, type Fragment, type SplitRow } from './splitDiff'

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
    expect(m.frags.map((x) => [x.l1Start, x.l2Start])).toEqual([
      [0, 0],
      [4, 4],
    ])
  })

  it('handles a new file: empty left side, one added fragment', () => {
    const f = parseUnifiedDiff('diff --git a/n.md b/n.md\nnew file mode 100644\n--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+x\n+y\n')[0]!
    const m = splitModel(f, changeBlocks(f), flat)
    expect(m.left).toEqual([])
    expect(text(m.right)).toEqual(['x', 'y'])
    expect(m.frags).toEqual([{ block: 0, type: 'added', l1Start: 0, l1End: 0, l2Start: 0, l2End: 2 }])
  })
})

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
