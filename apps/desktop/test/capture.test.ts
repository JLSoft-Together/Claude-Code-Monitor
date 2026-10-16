import { describe, expect, it } from 'vitest'
import { DUST_MAX_PIXELS, dustSize } from '../src/capture'

describe('dustSize', () => {
  it('scales a HiDPI capture down to its layout size', () => {
    expect(dustSize(200, 40, { width: 400, height: 80 })).toEqual({ width: 200, height: 40 })
  })

  it('caps big areas at the pixel budget, keeping the aspect', () => {
    const s = dustSize(1000, 800, { width: 2000, height: 1600 })
    expect(s.width * s.height).toBeLessThanOrEqual(DUST_MAX_PIXELS + 1000)
    expect(s.width / s.height).toBeCloseTo(1.25, 1)
  })

  it('never upscales past the captured pixels', () => {
    expect(dustSize(300, 100, { width: 150, height: 50 })).toEqual({ width: 150, height: 50 })
  })
})
