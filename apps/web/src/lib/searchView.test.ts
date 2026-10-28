import { describe, expect, it } from 'vitest'
import { fileCount, highlighter, hitRuns, searchRows } from './searchView'

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
