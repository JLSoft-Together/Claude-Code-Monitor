import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diff'
import { blockAt, blockPatch, changeBlocks, foldRows, wordDiff } from './diffBlocks'

const head = ['diff --git a/f.ts b/f.ts', '--- a/f.ts', '+++ b/f.ts']
const parse = (...lines: string[]) => parseUnifiedDiff([...head, ...lines, ''].join('\n'))[0]!

describe('changeBlocks', () => {
  it('splits one hunk into added / modified / deleted blocks with 0-based ranges', () => {
    const file = parse('@@ -1,8 +1,8 @@', ' a', '-b', '+B', ' c', '+new', ' d', '-e', ' f', ' g')
    const blocks = changeBlocks(file)
    expect(blocks.map((b) => [b.type, b.line1, b.line2, b.vcsLine1, b.vcsLine2])).toEqual([
      ['modified', 1, 2, 1, 2],
      ['added', 3, 4, 3, 3],
      ['deleted', 5, 5, 4, 5],
    ])
    expect(blockAt(blocks, 1)).toBe(0)
    expect(blockAt(blocks, 3)).toBe(1)
    expect(blockAt(blocks, 5)).toBe(2)
    expect(blockAt(blocks, 0)).toBe(-1)
  })

  it('handles zero-count hunk starts (new file, deletion at the top)', () => {
    expect(changeBlocks(parse('@@ -0,0 +1,2 @@', '+x', '+y')).map((b) => [b.line1, b.line2, b.vcsLine1, b.vcsLine2])).toEqual([[0, 2, 0, 0]])
    expect(changeBlocks(parse('@@ -1,2 +0,0 @@', '-x', '-y')).map((b) => [b.type, b.line1, b.vcsLine1, b.vcsLine2])).toEqual([['deleted', 0, 0, 2]])
  })

  it('keeps a "no newline" note inside its block', () => {
    const blocks = changeBlocks(parse('@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b', '\\ No newline at end of file'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'modified', from: 1, to: 5 })
  })
})

describe('blockPatch', () => {
  it('turns a neighbouring addition into context and drops its deletion', () => {
    const file = parse('@@ -1,7 +1,7 @@', ' line 1', '-line 2', '+changed 2', ' line 3', '-line 4', '+changed 4', ' line 5', ' line 6', ' line 7')
    const [, second] = changeBlocks(file)
    const patch = blockPatch(file, second!)
    expect(patch.split('\n').slice(3)).toEqual(['@@ -1,7 +1,7 @@', ' line 1', ' changed 2', ' line 3', '-line 4', '+changed 4', ' line 5', ' line 6', ' line 7', ''])
  })

  it('numbers a window in the middle of a full-context hunk and keeps CR', () => {
    const body = Array.from({ length: 20 }, (_, i) => (i === 10 ? '-old\r' : ` l${i}\r`))
    body.splice(11, 0, '+new\r')
    const file = parse('@@ -1,20 +1,20 @@', ...body)
    const [block] = changeBlocks(file)
    const lines = blockPatch(file, block!).split('\n')
    expect(lines[3]).toBe('@@ -8,7 +8,7 @@')
    expect(lines[4]).toBe(' l7\r')
    expect(lines.slice(7, 9)).toEqual(['-old\r', '+new\r'])
  })

  it('handles a pure addition and a deletion at the end of the file', () => {
    const add = parse('@@ -1,2 +1,3 @@', ' a', '+b', ' c')
    expect(blockPatch(add, changeBlocks(add)[0]!).split('\n')[3]).toBe('@@ -1,2 +1,3 @@')
    const del = parse('@@ -1,3 +1,2 @@', ' a', ' b', '-c')
    expect(blockPatch(del, changeBlocks(del)[0]!).split('\n').slice(3, 7)).toEqual(['@@ -1,3 +1,2 @@', ' a', ' b', '-c'])
  })
})

describe('wordDiff', () => {
  it('marks only the changed words on each side', () => {
    const res = wordDiff(['const a = foo(1)'], ['const a = bar(1, 2)'])!
    expect(res.old[0]).toEqual([{ start: 10, end: 13 }])
    expect(res.new[0]).toEqual([
      { start: 10, end: 13 },
      { start: 15, end: 18 },
    ])
  })

  it('works across lines and gives up past the limit', () => {
    const res = wordDiff(['a b', 'c'], ['a x', 'c'])!
    expect(res.old).toEqual([[{ start: 2, end: 3 }], []])
    expect(res.new).toEqual([[{ start: 2, end: 3 }], []])
    const big = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ')
    expect(wordDiff([big], [big.split(' ').reverse().join(' ')])).toBeNull()
  })
})

describe('foldRows', () => {
  it('folds unchanged runs away from changes and opens expanded ones', () => {
    const changed = Array.from({ length: 20 }, (_, i) => i === 10)
    expect(foldRows(changed, 2)).toEqual([
      { kind: 'fold', from: 0, to: 8 },
      { kind: 'rows', from: 8, to: 13 },
      { kind: 'fold', from: 13, to: 20 },
    ])
    expect(foldRows(changed, 2, new Set([0]))).toEqual([
      { kind: 'rows', from: 0, to: 13 },
      { kind: 'fold', from: 13, to: 20 },
    ])
  })

  it('keeps short gaps visible', () => {
    const changed = [true, false, false, true]
    expect(foldRows(changed, 0)).toEqual([{ kind: 'rows', from: 0, to: 4 }])
  })
})
