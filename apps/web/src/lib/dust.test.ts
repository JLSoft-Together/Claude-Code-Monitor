import { afterEach, describe, expect, it, vi } from 'vitest'
import { dropKept, dustIn, gatherDelay, gatherFrames, GATHER_LAYER_MS, hasKept, keepStore, layerBand, layerOf, scatterFrames, scatterOf, travelOf, UNDO_MS } from './dust'

describe('dust layers', () => {
  it('sends left pixels to early layers and right pixels to late ones', () => {
    expect(layerOf(0, 100, 30, 0)).toBe(0)
    expect(layerOf(99, 100, 30, 0.99)).toBe(29)
    expect(layerOf(50, 100, 30, 0)).toBeLessThan(layerOf(50, 100, 30, 0.9))
    for (let i = 0; i < 200; i++) {
      const n = layerOf(Math.random() * 100, 100, 30, Math.random())
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(30)
    }
  })

  it('keeps every pixel inside its layer band, so layers can be cropped', () => {
    for (const [width, layers] of [[1, 28], [7, 20], [333, 28], [640, 20]] as const)
      for (let x = 0; x < width; x++)
        for (const r of [0, 0.25, 0.5, 0.999]) {
          const n = layerOf(x, width, layers, r)
          const [lo, hi] = layerBand(n, width, layers)
          expect(x).toBeGreaterThanOrEqual(lo)
          expect(x).toBeLessThan(hi)
        }
  })

  it('crops each band to about half the width', () => {
    const [lo, hi] = layerBand(10, 600, 20)
    expect(hi - lo).toBeLessThanOrEqual(600 * 0.6)
  })
})

describe('dust flight', () => {
  it('flies to the right and mostly up, within the travel', () => {
    const travel = travelOf(800, 400)
    expect(travel).toBe(160)
    expect(scatterOf(travel, 0.5, 0.5, 0.5).dy).toBeLessThan(0)
    for (const r of [0, 0.5, 0.999]) {
      const s = scatterOf(travel, r, r, r)
      expect(s.dx).toBeGreaterThan(0)
      expect(s.dy).toBeLessThan(travel * 0.1)
      expect(Math.hypot(s.dx, s.dy)).toBeLessThanOrEqual(travel * 1.15 + 1e-9)
      expect(Math.abs(s.rot)).toBeLessThanOrEqual(12)
    }
  })

  it('gathers along the scatter path backwards: starts where the scatter ends, settles on identity', () => {
    const s = { dx: 40, dy: -30, rot: 8 }
    const out = scatterFrames(s)
    const back = gatherFrames(s)
    expect(back[0]).toEqual(out[out.length - 1])
    expect(back[back.length - 1]).toEqual(out[0])
    expect(back[back.length - 1]).toMatchObject({ opacity: 1 })
    expect(back[0]).toMatchObject({ opacity: 0 })
    expect(back[1]!.offset).toBeCloseTo(0.65)
    expect(back[1]!.transform).toBe(out[1]!.transform)
  })

  it('staggers the gather right to left and lands within about 700 ms', () => {
    for (const count of [8, 12, 16]) {
      const delays = Array.from({ length: count }, (_, n) => gatherDelay(n, count))
      expect(delays[count - 1]).toBe(0)
      for (let n = 1; n < count; n++) expect(delays[n]).toBeLessThan(delays[n - 1]!)
      expect(delays[0]! + GATHER_LAYER_MS).toBeCloseTo(700)
    }
    expect(gatherDelay(0, 1)).toBe(0)
  })
})

describe('dust kept for undo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('frees an entry once it expires', () => {
    vi.useFakeTimers()
    const free = vi.fn()
    const store = keepStore<string>(12, UNDO_MS, free)
    store.put('a', 'A')
    vi.advanceTimersByTime(UNDO_MS - 1)
    expect(store.has('a')).toBe(true)
    expect(free).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(store.has('a')).toBe(false)
    expect(free).toHaveBeenCalledWith('A')
  })

  it('evicts the oldest entry past the limit', () => {
    vi.useFakeTimers()
    const free = vi.fn()
    const store = keepStore<string>(3, UNDO_MS, free)
    for (const k of ['a', 'b', 'c', 'd']) store.put(k, k.toUpperCase())
    expect(store.size).toBe(3)
    expect(store.has('a')).toBe(false)
    expect(free).toHaveBeenCalledTimes(1)
    expect(free).toHaveBeenCalledWith('A')
    store.put('b', 'B2')
    expect(free).toHaveBeenLastCalledWith('B')
    store.put('e', 'E')
    expect(store.has('c')).toBe(false)
    expect(store.has('b')).toBe(true)
  })

  it('drop frees at once, take hands the value over without freeing', () => {
    vi.useFakeTimers()
    const free = vi.fn()
    const store = keepStore<string>(12, UNDO_MS, free)
    store.put('a', 'A')
    store.put('b', 'B')
    store.drop('a')
    expect(free).toHaveBeenCalledWith('A')
    expect(store.take('b')).toBe('B')
    expect(store.take('b')).toBeUndefined()
    vi.advanceTimersByTime(UNDO_MS * 2)
    expect(free).toHaveBeenCalledTimes(1)
    store.drop('missing')
    expect(free).toHaveBeenCalledTimes(1)
  })

  it('a re-put restarts the clock', () => {
    vi.useFakeTimers()
    const free = vi.fn()
    const store = keepStore<string>(12, UNDO_MS, free)
    store.put('a', 'A')
    vi.advanceTimersByTime(UNDO_MS - 100)
    store.put('a', 'A2')
    vi.advanceTimersByTime(UNDO_MS - 100)
    expect(store.has('a')).toBe(true)
    vi.advanceTimersByTime(100)
    expect(store.has('a')).toBe(false)
    expect(free).toHaveBeenLastCalledWith('A2')
  })

  it('dustIn without a kept capture resolves false and leaves the element alone', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(hasKept('gone')).toBe(false)
    dropKept('gone')
    await expect(dustIn(el, 'gone')).resolves.toBe(false)
    expect(el.style.opacity).toBe('')
    expect(document.querySelector('[data-dust="in"]')).toBeNull()
    el.remove()
  })
})
