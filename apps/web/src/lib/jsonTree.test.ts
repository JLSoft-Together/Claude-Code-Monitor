import { describe, expect, it } from 'vitest'
import { CHILD_PAGE, flattenTree, parseTree, pathOf, pathsToDepth, previewOf, treeFormat } from './jsonTree'

const doc = { a: { b: [1, 2, { c: true }] }, 'x y': null, list: Array.from({ length: CHILD_PAGE + 5 }, (_, i) => i) }

describe('jsonTree', () => {
  it('builds copyable paths', () => {
    expect(pathOf(['a', 'b', 2, 'c'])).toBe('a.b[2].c')
    expect(pathOf([0, 'x y', 'z'])).toBe('[0]["x y"].z')
    expect(pathOf([])).toBe('')
  })

  it('flattens only expanded containers', () => {
    const { rows } = flattenTree(doc, { expanded: new Set(['', 'a']) })
    expect(rows.map((r) => r.path)).toEqual(['', 'a', 'a.b', '["x y"]', 'list'])
    expect(rows.find((r) => r.path === 'a.b')).toMatchObject({ kind: 'array', size: 3, expanded: false, preview: '[3]' })
  })

  it('pages long containers and caps rows', () => {
    const { rows } = flattenTree(doc, { expanded: new Set(['', 'list']) })
    const more = rows.find((r) => r.kind === 'more')
    expect(more).toMatchObject({ path: 'list#more', size: 5 })
    const all = flattenTree(doc, { expanded: new Set(['', 'list']), shown: new Map([['list', 1000]]) })
    expect(all.rows.some((r) => r.kind === 'more')).toBe(false)
    expect(flattenTree(doc, { expanded: new Set(['', 'list']), limit: 10 }).truncated).toBe(true)
  })

  it('filters by key and opens the way to hits', () => {
    const { rows } = flattenTree(doc, { expanded: new Set(), filter: 'C' })
    expect(rows.map((r) => r.path)).toEqual(['', 'a', 'a.b', 'a.b[2]', 'a.b[2].c'])
    expect(rows.filter((r) => r.hit).map((r) => r.path)).toEqual(['a.b[2].c'])
  })

  it('previews and depth expansion', () => {
    expect(previewOf('x'.repeat(300)).endsWith('…"')).toBe(true)
    expect(previewOf(null)).toBe('null')
    expect([...pathsToDepth(doc, 1)]).toEqual(['', 'a', 'list'])
  })

  it('parses json and yaml, reports errors', async () => {
    expect(treeFormat('a/B.JSON')).toBe('json')
    expect(treeFormat('x.yml')).toBe('yaml')
    expect(treeFormat('x.ts')).toBeNull()
    expect(await parseTree('{"a":1}', 'json')).toEqual({ ok: true, value: { a: 1 } })
    expect((await parseTree('{"a":', 'json')).ok).toBe(false)
    expect(await parseTree('a:\n  - 1\n  - b: x\n', 'yaml')).toEqual({ ok: true, value: { a: [1, { b: 'x' }] } })
    expect(await parseTree('a: 1\n---\nb: 2\n', 'yaml')).toEqual({ ok: true, value: [{ a: 1 }, { b: 2 }] })
    expect((await parseTree('a: [1, 2\n', 'yaml')).ok).toBe(false)
  })
})
