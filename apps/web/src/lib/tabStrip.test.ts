import { describe, expect, it } from 'vitest'
import { caretAt, flashKind, slotMoves, stepSlot, stripSlot, tabMoveIndex } from './tabStrip'

const items = [
  { left: 0, width: 100 },
  { left: 104, width: 60 },
  { left: 168, width: 80 },
]

const move = (all: string[], key: string, to: number): string[] => {
  const next = all.filter((k) => k !== key)
  next.splice(to, 0, key)
  return next
}

describe('strip slots', () => {
  it('picks the slot by tab midpoints', () => {
    expect(stripSlot(items, -20)).toBe(0)
    expect(stripSlot(items, 49)).toBe(0)
    expect(stripSlot(items, 51)).toBe(1)
    expect(stripSlot(items, 140)).toBe(2)
    expect(stripSlot(items, 300)).toBe(3)
    expect(stripSlot([], 10)).toBe(0)
  })

  it('places the caret in the gap before a tab, or after the last one', () => {
    expect(caretAt(items, 0, 4)).toBe(-2)
    expect(caretAt(items, 1, 4)).toBe(102)
    expect(caretAt(items, 3, 4)).toBe(250)
    expect(caretAt([], 0, 4)).toBeNull()
    expect(caretAt(items, 4, 4)).toBeNull()
  })

  it('ignores slots on either side of the dragged tab', () => {
    const order = ['a', 'b', 'c']
    expect(slotMoves(order, 'b', 1)).toBe(false)
    expect(slotMoves(order, 'b', 2)).toBe(false)
    expect(slotMoves(order, 'b', 0)).toBe(true)
    expect(slotMoves(order, 'b', 3)).toBe(true)
    expect(slotMoves(order, 'x', 0)).toBe(false)
  })
})

describe('tabMoveIndex', () => {
  it('reorders when every tab is on the strip', () => {
    const all = ['a', 'b', 'c', 'd']
    const to = tabMoveIndex(all, all, 'd', 1)
    expect(to).toBe(1)
    expect(move(all, 'd', to!)).toEqual(['a', 'd', 'b', 'c'])
    const right = tabMoveIndex(all, all, 'a', 4)
    expect(move(all, 'a', right!)).toEqual(['b', 'c', 'd', 'a'])
    expect(tabMoveIndex(all, all, 'b', 2)).toBeNull()
  })

  it('keeps tabs of other projects in place', () => {
    const all = ['a', 'x', 'b', 'y', 'c']
    const strip = ['a', 'b', 'c']
    expect(move(all, 'c', tabMoveIndex(all, strip, 'c', 0)!)).toEqual(['c', 'a', 'x', 'b', 'y'])
    expect(move(all, 'a', tabMoveIndex(all, strip, 'a', 3)!)).toEqual(['x', 'b', 'y', 'c', 'a'])
    expect(move(all, 'a', tabMoveIndex(all, strip, 'a', 2)!)).toEqual(['x', 'b', 'y', 'a', 'c'])
    expect(move(all, 'c', tabMoveIndex(all, strip, 'c', 1)!)).toEqual(['a', 'x', 'c', 'b', 'y'])
  })

  it('refuses unknown tabs', () => {
    expect(tabMoveIndex(['a', 'b'], ['a', 'b'], 'z', 0)).toBeNull()
    expect(tabMoveIndex(['a'], ['a', 'b'], 'b', 0)).toBeNull()
  })

  it('steps one place left or right, not past the ends', () => {
    const strip = ['a', 'b', 'c']
    expect(stepSlot(strip, 'b', -1)).toBe(0)
    expect(stepSlot(strip, 'b', 1)).toBe(3)
    expect(stepSlot(strip, 'a', -1)).toBeNull()
    expect(stepSlot(strip, 'c', 1)).toBeNull()
    expect(move(strip, 'b', tabMoveIndex(strip, strip, 'b', stepSlot(strip, 'b', 1)!)!)).toEqual(['a', 'c', 'b'])
  })
})

describe('flashKind', () => {
  it('flashes when a tab starts waiting, fails or finishes', () => {
    expect(flashKind({ status: 'working' }, { status: 'waiting' })).toBe('waiting')
    expect(flashKind({ status: 'working' }, { status: 'error' })).toBe('error')
    expect(flashKind({ status: 'working' }, { status: 'idle' })).toBe('done')
    expect(flashKind({ status: 'idle' }, { status: 'working' })).toBeNull()
    expect(flashKind({ status: 'waiting' }, { status: 'idle' })).toBeNull()
    expect(flashKind({}, { status: 'idle' })).toBeNull()
  })

  it('flashes once for a latched attention mark', () => {
    expect(flashKind({ status: 'idle' }, { status: 'idle', attention: 'done' })).toBe('done')
    expect(flashKind({ status: 'idle', attention: 'done' }, { status: 'idle', attention: 'done' })).toBeNull()
    expect(flashKind({ status: 'idle', attention: 'done' }, { status: 'idle' })).toBeNull()
  })
})
