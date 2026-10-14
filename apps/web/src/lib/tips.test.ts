import { describe, expect, it } from 'vitest'
import { TIP_GAP_MS, TIP_MAX_SHOWN, TIP_WINDOW_MS, parseTipState, shouldTip, tipKeys, type TipState } from './tips'

const fresh = (): TipState => ({ off: false, learned: [], shown: {} })

describe('shortcut tips', () => {
  it('tips after three mouse uses inside the window', () => {
    const now = 1_000_000_000
    expect(shouldTip(fresh(), 'newTab', [now - 2000, now - 1000], now, -Infinity)).toBe(false)
    expect(shouldTip(fresh(), 'newTab', [now - 2000, now - 1000, now], now, -Infinity)).toBe(true)
    expect(shouldTip(fresh(), 'newTab', [now - TIP_WINDOW_MS - 1, now - 1000, now], now, -Infinity)).toBe(false)
  })

  it('never for learned, off, or shown enough; spaced out', () => {
    const now = 1_000_000_000
    const uses = [now - 2, now - 1, now]
    expect(shouldTip({ ...fresh(), learned: ['split'] }, 'split', uses, now, -Infinity)).toBe(false)
    expect(shouldTip({ ...fresh(), off: true }, 'split', uses, now, -Infinity)).toBe(false)
    expect(shouldTip({ ...fresh(), shown: { split: TIP_MAX_SHOWN } }, 'split', uses, now, -Infinity)).toBe(false)
    expect(shouldTip(fresh(), 'split', uses, now, now - TIP_GAP_MS + 1)).toBe(false)
  })

  it('parses stored state defensively', () => {
    expect(parseTipState('{"off":true,"learned":["tab","bogus"],"shown":{"tab":9,"x":1}}')).toEqual({ off: true, learned: ['tab'], shown: { tab: TIP_MAX_SHOWN } })
    expect(parseTipState('garbage')).toEqual(fresh())
    expect(parseTipState(null)).toEqual(fresh())
  })

  it('names the chord per OS', () => {
    expect(tipKeys('newTab', false).keys).toBe('Ctrl+Shift+T')
    expect(tipKeys('newTab', true).keys).toBe('⌘T')
    expect(tipKeys('split', true).keys).toBe('⌘D')
    expect(tipKeys('tab', false).cycle).toBe('Ctrl+Tab')
  })
})
