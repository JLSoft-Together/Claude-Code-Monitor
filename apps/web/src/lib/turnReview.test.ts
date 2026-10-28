import { describe, expect, it } from 'vitest'
import { turnPair } from './turnReview'

const cp = (id: string, label: string) => ({ id, at: 0, label })

describe('turnPair', () => {
  const list = [cp('a2', 'after:fix'), cp('b2', 'before:fix'), cp('a1', 'after:x'), cp('m', 'manual'), cp('b1', 'before:x'), cp('b0', 'before:y')]

  it('pairs an after with the nearest older before and back', () => {
    expect(turnPair(list, 'a2')).toMatchObject({ before: { id: 'b2' }, after: { id: 'a2' }, title: 'fix' })
    expect(turnPair(list, 'b2')).toMatchObject({ before: { id: 'b2' }, after: { id: 'a2' } })
    expect(turnPair(list, 'a1')).toMatchObject({ before: { id: 'b1' }, title: 'x' })
  })

  it('refuses a before with no after of its own and unknown labels', () => {
    expect(turnPair(list, 'b0')).toBeNull()
    expect(turnPair(list, 'm')).toBeNull()
    expect(turnPair(list, 'nope')).toBeNull()
  })
})
