import { describe, expect, it } from 'vitest'
import { addItem, editItem, emptyQueue, moveItem, parseQueue, QUEUE_MAX_ITEMS, removeItem, serializeQueue, setPaused, shouldAutoFill, takeNext, turnEnded } from './promptQueue'

const three = () => addItem(addItem(addItem(emptyQueue(), 'a', '1'), 'b', '2'), 'c', '3')

describe('promptQueue', () => {
  it('adds trimmed items and skips blanks and overflow', () => {
    expect(addItem(emptyQueue(), '  hi  ', 'x').items).toEqual([{ id: 'x', text: 'hi' }])
    expect(addItem(emptyQueue(), '   ', 'x').items).toEqual([])
    let q = emptyQueue()
    for (let i = 0; i < QUEUE_MAX_ITEMS + 3; i++) q = addItem(q, `p${i}`, `${i}`)
    expect(q.items).toHaveLength(QUEUE_MAX_ITEMS)
  })

  it('edits, removes on blank edit and removes by id', () => {
    expect(editItem(three(), '2', ' B ').items.map((i) => i.text)).toEqual(['a', 'B', 'c'])
    expect(editItem(three(), '2', '').items.map((i) => i.id)).toEqual(['1', '3'])
    expect(removeItem(three(), '1').items.map((i) => i.id)).toEqual(['2', '3'])
  })

  it('moves items and clamps at the ends', () => {
    expect(moveItem(three(), '3', -1).items.map((i) => i.id)).toEqual(['1', '3', '2'])
    expect(moveItem(three(), '1', 1).items.map((i) => i.id)).toEqual(['2', '1', '3'])
    expect(moveItem(three(), '1', -1)).toEqual(three())
    expect(moveItem(three(), '2', 9).items.map((i) => i.id)).toEqual(['1', '3', '2'])
  })

  it('takes the head item', () => {
    const r = takeNext(three())
    expect(r?.item).toEqual({ id: '1', text: 'a' })
    expect(r?.queue.items.map((i) => i.id)).toEqual(['2', '3'])
    expect(takeNext(emptyQueue())).toBeNull()
  })

  it('fills only on a working → idle edge while not paused', () => {
    expect(turnEnded('working', 'idle')).toBe(true)
    expect(turnEnded('working', 'waiting')).toBe(false)
    expect(turnEnded('idle', 'idle')).toBe(false)
    expect(turnEnded(undefined, 'idle')).toBe(false)
    expect(shouldAutoFill(three(), 'working', 'idle')).toBe(true)
    expect(shouldAutoFill(setPaused(three(), true), 'working', 'idle')).toBe(false)
    expect(shouldAutoFill(emptyQueue(), 'working', 'idle')).toBe(false)
  })

  it('round-trips storage and rejects junk', () => {
    const q = setPaused(three(), true)
    expect(parseQueue(serializeQueue(q))).toEqual(q)
    expect(serializeQueue(emptyQueue())).toBeNull()
    expect(parseQueue('{bad')).toEqual(emptyQueue())
    expect(parseQueue(JSON.stringify({ items: [{ id: 1, text: 'x' }, { id: 'a', text: ' ' }, { id: 'b', text: 'ok' }] })).items).toEqual([{ id: 'b', text: 'ok' }])
  })
})
