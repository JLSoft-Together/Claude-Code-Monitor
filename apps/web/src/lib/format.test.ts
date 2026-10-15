import { afterEach, describe, expect, it, vi } from 'vitest'
import { now, relativeTime, startClock, stopClock } from './format'

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('clock', () => {
  afterEach(() => {
    stopClock()
    setHidden(false)
    vi.useRealTimers()
  })

  it('ticks every second, pauses while hidden and ticks at once on return', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    startClock()
    expect(now.value).toBe(1_000_000)
    vi.advanceTimersByTime(1_000)
    expect(now.value).toBe(1_001_000)

    setHidden(true)
    vi.advanceTimersByTime(10_000)
    expect(now.value).toBe(1_001_000)
    expect(vi.getTimerCount()).toBe(0)

    setHidden(false)
    expect(now.value).toBe(1_011_000)
    vi.advanceTimersByTime(1_000)
    expect(now.value).toBe(1_012_000)
  })
})

describe('relativeTime', () => {
  it('formats with a cached formatter per locale', () => {
    const spy = vi.spyOn(Intl, 'RelativeTimeFormat')
    const base = Date.parse('2026-10-15T10:00:00Z')
    expect(relativeTime('2026-10-15T09:59:30Z', 'en', base)).toBe('30 sec. ago')
    relativeTime('2026-10-15T09:00:00Z', 'en', base)
    relativeTime(base - 120_000, 'en', base)
    relativeTime(base - 120_000, 'vi', base)
    relativeTime(base - 120_000, 'vi', base)
    expect(spy.mock.calls.filter(([l]) => l === 'en').length).toBeLessThanOrEqual(1)
    expect(spy.mock.calls.filter(([l]) => l === 'vi').length).toBeLessThanOrEqual(1)
    spy.mockRestore()
    expect(relativeTime(undefined, 'en', base)).toBeNull()
  })
})
