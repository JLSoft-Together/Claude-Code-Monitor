import { describe, expect, it } from 'vitest'
import { FxBudget, LOW_FX_RETRIES } from './fxBudget'

function run(b: FxBudget, from: number, ms: number, step: number): number {
  let t = from
  for (; t < from + ms; t += step) b.tick(t)
  return t
}

describe('3D effect budget', () => {
  it('stays full at a smooth frame rate', () => {
    const b = new FxBudget()
    run(b, 0, 10_000, 16)
    expect(b.low).toBe(false)
  })

  it('drops effects after slow frames hold for a while', () => {
    const b = new FxBudget()
    let t = run(b, 0, 1500, 120)
    expect(b.low).toBe(false)
    t = run(b, t, 2000, 120)
    expect(b.low).toBe(true)
  })

  it('ignores a single long pause', () => {
    const b = new FxBudget()
    let t = run(b, 0, 1000, 16)
    t += 5000
    run(b, t, 1000, 16)
    expect(b.low).toBe(false)
  })

  it('brings effects back when frames recover, then gives up after retries', () => {
    const b = new FxBudget()
    let t = run(b, 0, 4000, 120)
    expect(b.low).toBe(true)
    for (let i = 0; i < LOW_FX_RETRIES; i++) {
      t = run(b, t, 7000, 16)
      expect(b.low).toBe(false)
      t = run(b, t, 4000, 120)
      expect(b.low).toBe(true)
    }
    run(b, t, 20_000, 16)
    expect(b.low).toBe(true)
  })
})
