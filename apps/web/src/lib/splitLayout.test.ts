import { describe, expect, it } from 'vitest'
import { boxes, dividers, isLayout, leaves, neighbor, removeLeaf, setRatio, splitLeaf, type LayoutNode } from './splitLayout'

// a | (b / c)
const tree: LayoutNode = splitLeaf(splitLeaf({ pane: 'a' }, 'a', 'b', 'row'), 'b', 'c', 'col')

describe('layout tree', () => {
  it('splits a leaf in place and keeps order', () => {
    expect(leaves(tree)).toEqual(['a', 'b', 'c'])
    expect(boxes(tree).get('c')).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })

  it('removing a leaf lets its sibling take the parent slot', () => {
    const t = removeLeaf(tree, 'b')!
    expect(leaves(t)).toEqual(['a', 'c'])
    expect(boxes(t).get('c')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    expect(removeLeaf({ pane: 'a' }, 'a')).toBeNull()
    expect(removeLeaf(tree, 'zz')).toBe(tree)
  })

  it('clamps ratios and addresses nested splits by path', () => {
    const t = setRatio(setRatio(tree, '', 0.99), 'b', 0.3)
    const d = dividers(t)
    expect(d.map((x) => [x.path, x.dir, x.ratio])).toEqual([
      ['', 'row', 0.85],
      ['b', 'col', 0.3],
    ])
    expect(boxes(t).get('a')!.w).toBeCloseTo(0.85)
  })

  it('moves focus to the adjacent pane', () => {
    expect(neighbor(tree, 'a', 'right')).toBe('b')
    expect(neighbor(tree, 'b', 'down')).toBe('c')
    expect(neighbor(tree, 'c', 'up')).toBe('b')
    expect(neighbor(tree, 'c', 'left')).toBe('a')
    expect(neighbor(tree, 'a', 'left')).toBeNull()
    expect(neighbor(tree, 'b', 'right')).toBeNull()
  })

  it('validates stored trees', () => {
    expect(isLayout(tree)).toBe(true)
    expect(isLayout({ dir: 'row', ratio: 0.5, a: { pane: 'a' } })).toBe(false)
    expect(isLayout(null)).toBe(false)
  })
})
