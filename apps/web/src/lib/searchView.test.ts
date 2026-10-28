import { describe, expect, it } from 'vitest'
import { expandReplacement, fileCount, fileTick, highlighter, hitRuns, replacePlan, replaceRuns, searchRows } from './searchView'

const m = (path: string, line: number, text = 'x') => ({ path, line, col: 1, text })

describe('searchRows', () => {
  it('groups by file and hides collapsed matches', () => {
    const ms = [m('a.ts', 1), m('a.ts', 5), m('b.ts', 2)]
    expect(searchRows(ms, new Set()).map((r) => r.kind)).toEqual(['file', 'match', 'match', 'file', 'match'])
    const shut = searchRows(ms, new Set(['a.ts']))
    expect(shut.map((r) => r.kind)).toEqual(['file', 'file', 'match'])
    expect(shut[0]).toMatchObject({ count: 2, collapsed: true })
    expect(fileCount(ms)).toBe(2)
  })
})

describe('highlight', () => {
  it('escapes literal queries and honours case', () => {
    const re = highlighter({ q: 'a.b', regex: false, caseSensitive: false, word: false })
    expect(hitRuns('xA.Byaxb', re)).toEqual([
      { text: 'x', hit: false },
      { text: 'A.B', hit: true },
      { text: 'yaxb', hit: false },
    ])
  })

  it('whole word and bad regex', () => {
    const re = highlighter({ q: 'foo', regex: false, caseSensitive: true, word: true })
    expect(hitRuns('foo food foo', re).filter((r) => r.hit)).toHaveLength(2)
    expect(highlighter({ q: '(', regex: true, caseSensitive: true, word: false })).toBeNull()
    expect(hitRuns('abc', null)).toEqual([{ text: 'abc', hit: false }])
  })
})

describe('replace preview', () => {
  it('shows each hit struck out followed by its replacement', () => {
    const re = highlighter({ q: 'old(\\w)', regex: true, caseSensitive: true, word: false })
    expect(replaceRuns('x oldA y oldB', re, 'new$1', true)).toEqual([
      { text: 'x ', kind: 'plain' },
      { text: 'oldA', kind: 'del' },
      { text: 'newA', kind: 'ins' },
      { text: ' y ', kind: 'plain' },
      { text: 'oldB', kind: 'del' },
      { text: 'newB', kind: 'ins' },
    ])
    expect(replaceRuns('a.b', highlighter({ q: 'a.b', regex: false, caseSensitive: true, word: false }), '$1', false)).toEqual([
      { text: 'a.b', kind: 'del' },
      { text: '$1', kind: 'ins' },
    ])
    expect(replaceRuns('abc', null, 'x', false)).toEqual([{ text: 'abc', kind: 'plain' }])
  })

  it('expands only $1..$9 and $&', () => {
    const m = 'k=v'.match(/(\w)=(\w)/)!
    expect(expandReplacement('$2$1 $& $$ $3', m, true)).toBe('vk k=v $$ $3')
  })

  it('groups ticked results per file and reports file ticks', () => {
    const ms = [m('a.ts', 1, 'one'), m('a.ts', 4, 'two'), m('b.ts', 2, 'three')]
    expect(replacePlan(ms, new Set([1]))).toEqual({
      files: [
        { path: 'a.ts', lines: [{ line: 1, text: 'one' }] },
        { path: 'b.ts', lines: [{ line: 2, text: 'three' }] },
      ],
      lines: 2,
    })
    expect(replacePlan(ms, new Set([0, 1, 2]))).toEqual({ files: [], lines: 0 })
    expect(fileTick(0, 2, new Set())).toBe('all')
    expect(fileTick(0, 2, new Set([1]))).toBe('some')
    expect(fileTick(0, 2, new Set([0, 1]))).toBe('none')
    expect(searchRows(ms, new Set())[3]).toMatchObject({ kind: 'file', path: 'b.ts', first: 2 })
  })
})
