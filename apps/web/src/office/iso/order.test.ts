import { describe, expect, it } from 'vitest'
import { frameOps, type DrawOp } from './order'

const str = (ops: DrawOp[]) => ops.map((o) => `${o.k[0]}${o.i}`).join(' ')

describe('front overlay ordering', () => {
  it('without fronts it interleaves characters by rank', () => {
    expect(str(frameOps(3, [0.5, 2.5], [[], []], () => false))).toBe('s0 c0 s1 s2 c1')
  })

  it('an empty chair draws its front right after its base', () => {
    expect(str(frameOps(2, [], [], (i) => i === 0))).toBe('s0 f0 s1')
  })

  it('the front waits for the character seated in it', () => {
    expect(str(frameOps(3, [0.5, 1.5], [[0], []], (i) => i === 0))).toBe('s0 c0 f0 s1 c1 s2')
  })

  it('the front waits for every occupant, also one drawn later', () => {
    expect(str(frameOps(3, [0.5, 2.5], [[0], [0]], (i) => i === 0))).toBe('s0 c0 s1 s2 c1 f0')
  })

  it('an occupant drawn before the base does not hold the front back', () => {
    expect(str(frameOps(2, [-0.5], [[1]], (i) => i === 1))).toBe('c0 s0 s1 f1')
  })

  it('a front whose occupants were all drawn earlier stays right after its base, not at the end of the frame', () => {
    expect(str(frameOps(4, [0.5], [[2]], (i) => i === 2))).toBe('s0 c0 s1 s2 f2 s3')
  })

  it('a seated character sits between the chair base and its backrest', () => {
    const ops = str(frameOps(5, [-0.5, 2.5, 3.5], [[], [2], []], (i) => i === 2))
    expect(ops).toBe('c0 s0 s1 s2 c1 f2 s3 c2 s4')
  })

  it('a character in two fronts (desk and chair) releases both', () => {
    expect(str(frameOps(2, [1.5], [[0, 1]], () => true))).toBe('s0 s1 c0 f0 f1')
  })

  it('reuses the output array', () => {
    const out: DrawOp[] = [{ k: 'char', i: 9 }]
    expect(frameOps(1, [], [], () => false, out)).toBe(out)
    expect(str(out)).toBe('s0')
  })
})
