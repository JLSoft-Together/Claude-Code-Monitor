import { describe, expect, it } from 'vitest'
import { onlyTag, tagCounts, tagOf, TODO_QUERY, todoMatches } from './todoView'

const m = (path: string, line: number, text: string, col = text.search(/TODO|FIXME|HACK|XXX/) + 1) => ({ path, line, col, text })

describe('todoView', () => {
  it('asks git grep for whole-word, case-sensitive tags', () => {
    expect(TODO_QUERY).toEqual({ q: 'TODO|FIXME|HACK|XXX', regex: true, caseSensitive: true, word: true })
  })

  it('reads the tag at the match column, else anywhere in the line', () => {
    expect(tagOf(m('a.ts', 1, '// FIXME: later'))).toBe('FIXME')
    expect(tagOf({ path: 'a', line: 1, col: 1, text: '  # HACK around it' })).toBe('HACK')
    expect(tagOf({ path: 'a', line: 1, col: 1, text: 'todo lower' })).toBeNull()
    expect(tagOf({ path: 'a', line: 1, col: 1, text: 'TODOS' })).toBeNull()
  })

  it('counts and filters by tag', () => {
    const items = todoMatches([m('a.ts', 1, '// TODO one'), m('a.ts', 9, '/* XXX */'), m('b.py', 2, '# TODO two'), { path: 'c', line: 1, col: 1, text: '…cut' }])
    expect(items).toHaveLength(3)
    expect(tagCounts(items)).toEqual({ TODO: 2, FIXME: 0, HACK: 0, XXX: 1 })
    expect(onlyTag(items, 'TODO').map((i) => `${i.path}:${i.line}`)).toEqual(['a.ts:1', 'b.py:2'])
    expect(onlyTag(items, null)).toHaveLength(3)
  })
})
