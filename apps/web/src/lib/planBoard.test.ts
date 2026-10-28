import { describe, expect, it } from 'vitest'
import { parsePlanItems, pendingItems, planCounts, PLAN_FILE, sortPlanFiles, toggleItem } from './planBoard'

const DOC = ['# Plan', '', '- [ ] First', '  - [x] Child done', '    * [~] Grandchild partial', '- [X] Second', '1. [ ] Numbered', '```', '- [ ] in code', '```', '- [] not a box', '-[ ] no space'].join('\r\n')

describe('parsePlanItems', () => {
  it('keeps exact lines, states and nesting', () => {
    expect(parsePlanItems(DOC)).toEqual([
      { line: 3, depth: 0, state: 'todo', text: 'First' },
      { line: 4, depth: 1, state: 'done', text: 'Child done' },
      { line: 5, depth: 2, state: 'partial', text: 'Grandchild partial' },
      { line: 6, depth: 0, state: 'done', text: 'Second' },
      { line: 7, depth: 0, state: 'todo', text: 'Numbered' },
    ])
  })

  it('treats a tab as indentation', () => {
    expect(parsePlanItems('- [ ] a\n\t- [ ] b').map((x) => x.depth)).toEqual([0, 1])
  })

  it('filters and counts', () => {
    const items = parsePlanItems(DOC)
    expect(pendingItems(items).map((x) => x.line)).toEqual([3, 5, 7])
    expect(planCounts(items)).toEqual({ done: 2, total: 5 })
  })
})

describe('toggleItem', () => {
  const items = parsePlanItems(DOC)

  it('flips only that line and keeps CRLF', () => {
    const next = toggleItem(DOC, items[0]!)!
    expect(next.split('\r\n')[2]).toBe('- [x] First')
    expect(next.replace('- [x] First', '- [ ] First')).toBe(DOC)
    expect(toggleItem(DOC, items[1]!)!.split('\r\n')[3]).toBe('  - [ ] Child done')
    expect(toggleItem(DOC, items[2]!)!.split('\r\n')[4]).toBe('    * [x] Grandchild partial')
    expect(toggleItem(DOC, items[3]!)!.split('\r\n')[5]).toBe('- [ ] Second')
  })

  it('refuses when the line changed', () => {
    expect(toggleItem(DOC, { ...items[0]!, line: 4 })).toBeNull()
    expect(toggleItem(DOC, { ...items[0]!, state: 'done' })).toBeNull()
    expect(toggleItem(DOC, { ...items[0]!, line: 99 })).toBeNull()
  })
})

describe('plan files', () => {
  it('matches the planning prefixes', () => {
    expect(['PLAN-v1.md', 'progress-2026.md', 'SPEC-x.md', 'TODO-a.md', 'NOTES.md', 'PLAN-x.txt', 'HANDOFF-1.md'].filter((n) => PLAN_FILE.test(n))).toEqual([
      'PLAN-v1.md',
      'progress-2026.md',
      'SPEC-x.md',
      'TODO-a.md',
    ])
  })

  it('sorts newest first', () => {
    const f = (name: string, mtimeMs: number) => ({ path: name, name, mtimeMs, items: [] })
    expect(sortPlanFiles([f('a', 1), f('b', 3), f('c', 2)]).map((x) => x.name)).toEqual(['b', 'c', 'a'])
  })
})
