import { beforeEach, describe, expect, it } from 'vitest'
import { clampSideWidth, readSideWidth, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, SIDE_WIDTH_KEY, STAGE_MIN, writeSideWidth } from './sideWidth'

describe('sidebar width', () => {
  beforeEach(() => localStorage.clear())

  it('clamps into [SIDE_MIN, SIDE_MAX]', () => {
    expect(clampSideWidth(50)).toBe(SIDE_MIN)
    expect(clampSideWidth(9999)).toBe(SIDE_MAX)
    expect(clampSideWidth(301.6)).toBe(302)
  })

  it('leaves the stage STAGE_MIN of the window', () => {
    expect(clampSideWidth(500, 800)).toBe(800 - STAGE_MIN)
  })

  it('never goes under SIDE_MIN, even in a tiny window', () => {
    expect(clampSideWidth(300, 500)).toBe(SIDE_MIN)
  })

  it('falls back to the default for NaN / garbage / nothing stored', () => {
    expect(clampSideWidth(Number.NaN)).toBe(SIDE_DEFAULT)
    expect(readSideWidth()).toBe(SIDE_DEFAULT)
    localStorage.setItem(SIDE_WIDTH_KEY, 'wide')
    expect(readSideWidth()).toBe(SIDE_DEFAULT)
  })

  it('round-trips and clamps a stored value', () => {
    writeSideWidth(333)
    expect(readSideWidth()).toBe(333)
    localStorage.setItem(SIDE_WIDTH_KEY, '9999')
    expect(readSideWidth()).toBe(SIDE_MAX)
  })
})
