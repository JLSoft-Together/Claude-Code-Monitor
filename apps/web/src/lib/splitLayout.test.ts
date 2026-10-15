import { describe, expect, it } from 'vitest'
import { boxes, dividers, dockSpot, dockTree, dropTargetAt, edgeAt, isLayout, leaves, movePane, neighbor, removeLeaf, setRatio, splitLeaf, swapPanes, type LayoutNode, type Rect } from './splitLayout'

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

describe('pane docking', () => {
  it('docks a pane on each edge of a leaf', () => {
    const one: LayoutNode = { pane: 'a' }
    expect(dockTree(one, 'a', { pane: 'x' }, 'left')).toEqual({ dir: 'row', ratio: 0.5, a: { pane: 'x' }, b: { pane: 'a' } })
    expect(dockTree(one, 'a', { pane: 'x' }, 'right')).toEqual({ dir: 'row', ratio: 0.5, a: { pane: 'a' }, b: { pane: 'x' } })
    expect(dockTree(one, 'a', { pane: 'x' }, 'top')).toEqual({ dir: 'col', ratio: 0.5, a: { pane: 'x' }, b: { pane: 'a' } })
    expect(dockTree(one, 'a', { pane: 'x' }, 'bottom')).toEqual({ dir: 'col', ratio: 0.5, a: { pane: 'a' }, b: { pane: 'x' } })
    expect(dockTree(tree, 'zz', { pane: 'x' }, 'left')).toBe(tree)
  })

  it('docks a whole tree next to a leaf', () => {
    const sub: LayoutNode = splitLeaf({ pane: 'x' }, 'x', 'y', 'col')
    const t = dockTree(tree, 'c', sub, 'right')
    expect(leaves(t)).toEqual(['a', 'b', 'c', 'x', 'y'])
    expect(boxes(t).get('y')).toEqual({ x: 0.75, y: 0.75, w: 0.25, h: 0.25 })
  })

  it('moves a pane to another edge without losing panes', () => {
    // a | (b / c) → c moves left of a: (c | a) | b
    const t = movePane(tree, 'c', 'a', 'left')
    expect(leaves(t)).toEqual(['c', 'a', 'b'])
    expect(boxes(t).get('b')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    expect(boxes(t).get('c')).toEqual({ x: 0, y: 0, w: 0.25, h: 1 })
    expect(movePane(tree, 'a', 'a', 'left')).toBe(tree)
    expect(movePane(tree, 'zz', 'a', 'left')).toBe(tree)
  })

  it('swaps two leaves and keeps the shape', () => {
    const t = swapPanes(tree, 'a', 'c')
    expect(leaves(t)).toEqual(['c', 'b', 'a'])
    expect(dividers(t)).toEqual(dividers(tree))
    expect(swapPanes(tree, 'a', 'zz')).toBe(tree)
  })

  it('picks the nearest edge by fraction of the size', () => {
    const r: Rect = { left: 0, top: 0, right: 400, bottom: 100 }
    expect(edgeAt(r, 10, 50)).toBe('left')
    expect(edgeAt(r, 390, 50)).toBe('right')
    expect(edgeAt(r, 200, 10)).toBe('top')
    expect(edgeAt(r, 200, 95)).toBe('bottom')
    // 60px from the left of a 400px pane is 15%; 20px from the top of 100px is 20%.
    expect(edgeAt(r, 60, 20)).toBe('left')
  })

  it('finds the pane under the pointer, never the source', () => {
    const rects = new Map<string, Rect>([
      ['a', { left: 0, top: 0, right: 100, bottom: 100 }],
      ['b', { left: 108, top: 0, right: 208, bottom: 100 }],
    ])
    expect(dropTargetAt(rects, 190, 50, 'a')).toEqual({ key: 'b', edge: 'right' })
    expect(dropTargetAt(rects, 50, 50, 'a')).toBeNull()
    expect(dropTargetAt(rects, 104, 50, 'a')).toBeNull()
  })
})

describe('dock spot', () => {
  it('splits the roomiest pane along its longer side, the focused one on a tie', () => {
    expect(dockSpot(tree, 'c', { w: 1600, h: 900 })).toEqual({ key: 'a', dir: 'col' })
    expect(dockSpot(tree, 'c', { w: 1600, h: 900 })).toEqual(dockSpot(tree, 'b', { w: 1600, h: 900 }))
    expect(dockSpot(splitLeaf({ pane: 'a' }, 'a', 'b', 'row'), 'b', { w: 1600, h: 900 })).toEqual({ key: 'b', dir: 'col' })
    expect(dockSpot({ pane: 'a' }, 'a', { w: 1600, h: 900 })).toEqual({ key: 'a', dir: 'row' })
    expect(dockSpot({ pane: 'a' }, 'a', { w: 0, h: 0 })).toEqual({ key: 'a', dir: 'row' })
  })

  it('falls back to the other side, then to the roomiest pane, then gives up', () => {
    // c is 250 × 150: too small both ways; a (250 × 300) is taller than wide, so it halves downward.
    expect(dockSpot(tree, 'c', { w: 500, h: 300 })).toEqual({ key: 'a', dir: 'col' })
    expect(dockSpot({ pane: 'a' }, 'a', { w: 300, h: 600 })).toEqual({ key: 'a', dir: 'col' })
    expect(dockSpot({ pane: 'a' }, 'a', { w: 400, h: 250 })).toBeNull()
  })
})
