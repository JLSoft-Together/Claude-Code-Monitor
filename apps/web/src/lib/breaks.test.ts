import { describe, expect, it } from 'vitest'
import { breakAnchor, breakSlot, nextBreakAt } from './breaks'

const at = (h: number, m: number, day = 8) => new Date(2026, 9, day, h, m).getTime()

describe('break reminders', () => {
  it('counts 45-minute slots from the first start today', () => {
    const anchor = breakAnchor(new Date(at(8, 0)).toISOString(), at(9, 40))!
    expect(anchor).toBe(at(8, 0))
    expect(breakSlot(anchor, at(8, 44))).toBe(0)
    expect(breakSlot(anchor, at(8, 45))).toBe(1)
    expect(breakSlot(anchor, at(9, 40))).toBe(2)
    expect(nextBreakAt(anchor, at(9, 40))).toBe(at(10, 15))
  })

  it('falls back to midnight when the collector started yesterday', () => {
    expect(breakAnchor(new Date(at(22, 0, 7)).toISOString(), at(1, 0))).toBe(at(0, 0))
  })

  it('has no anchor without a valid start', () => {
    expect(breakAnchor(null, at(9, 0))).toBeNull()
    expect(breakAnchor('nope', at(9, 0))).toBeNull()
  })
})
