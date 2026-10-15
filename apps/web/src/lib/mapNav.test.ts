import { describe, expect, it } from 'vitest'
import type { Agent } from '@ccm/shared'
import { buildNav, childCounts, hideCollapsed, navigate } from './mapNav'

const ag = (id: string, terminalId: string, parentId?: string, role: Agent['role'] = 'subagent'): Agent => ({ id, terminalId, parentId, role, status: 'working' })

// t1: m1 → a (→ a1, a2), b ; t2: m2 → c ; orphan o (parent not on the map) hangs off m1.
const t1 = [ag('m1', 't1', undefined, 'main'), ag('a', 't1', 'm1'), ag('a1', 't1', 'a'), ag('a2', 't1', 'a'), ag('b', 't1', 'm1'), ag('o', 't1', 'gone')]
const t2 = [ag('m2', 't2', undefined, 'main'), ag('c', 't2', 'm2')]
const nav = buildNav(['t1', 't2'], { t1, t2 })

describe('buildNav', () => {
  it('stacks each session main first, then tree order', () => {
    expect(nav.columns).toEqual([
      ['m1', 'a', 'a1', 'a2', 'b', 'o'],
      ['m2', 'c'],
    ])
    expect(nav.parent.get('o')).toBe('m1')
    expect(nav.firstChild.get('a')).toBe('a1')
  })
})

describe('navigate', () => {
  it('↑↓ walk the column and stop at its ends', () => {
    expect(navigate(nav, 'a', 'ArrowDown')).toBe('a1')
    expect(navigate(nav, 'a', 'ArrowUp')).toBe('m1')
    expect(navigate(nav, 'm1', 'ArrowUp')).toBeNull()
    expect(navigate(nav, 'o', 'ArrowDown')).toBeNull()
  })
  it('← parent, → first child; on a root they switch session', () => {
    expect(navigate(nav, 'a2', 'ArrowLeft')).toBe('a')
    expect(navigate(nav, 'a', 'ArrowRight')).toBe('a1')
    expect(navigate(nav, 'b', 'ArrowRight')).toBeNull()
    expect(navigate(nav, 'm1', 'ArrowRight')).toBe('m2')
    expect(navigate(nav, 'm2', 'ArrowLeft')).toBe('m1')
    expect(navigate(nav, 'm1', 'ArrowLeft')).toBeNull()
  })
  it('Home / End and an unknown start', () => {
    expect(navigate(nav, 'a1', 'Home')).toBe('m1')
    expect(navigate(nav, 'a1', 'End')).toBe('o')
    expect(navigate(nav, null, 'ArrowDown')).toBe('m1')
    expect(navigate(nav, 'nope', 'ArrowDown')).toBe('m1')
  })
})

describe('folding', () => {
  it('counts children with the map parent rules', () => {
    const c = childCounts([...t1, ...t2])
    expect(c.get('m1')).toBe(3)
    expect(c.get('a')).toBe(2)
    expect(c.get('b')).toBeUndefined()
  })
  it('hides descendants of a collapsed agent and counts them', () => {
    const { visible, hiddenUnder } = hideCollapsed([...t1, ...t2], new Set(['a']))
    expect([...visible].sort()).toEqual(['a', 'b', 'c', 'm1', 'm2', 'o'])
    expect(hiddenUnder.get('a')).toBe(2)
  })
  it('nested folds: only the outer one shows a count, whatever the order', () => {
    for (const order of [['m1', 'a'], ['a', 'm1']]) {
      const { visible, hiddenUnder } = hideCollapsed(t1, new Set(order))
      expect([...visible]).toEqual(['m1'])
      expect(hiddenUnder.get('m1')).toBe(5)
      expect(hiddenUnder.has('a')).toBe(false)
    }
  })
})
