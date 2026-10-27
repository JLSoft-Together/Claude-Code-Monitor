import { describe, expect, it } from 'vitest'
import { ellipsize, fitSign, nineSlice, SIGN_LINE, SIGN_SIZE_MAX, SIGN_SIZE_MIN, SIGN_SIZE_READ, signLineYs, signSpare, splitName } from './sign'

const measure = (font: string, t: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]) * 0.55 * Array.from(t).length

describe('iso wall sign text', () => {
  const box = { w: 40.5, h: 8.5 }

  it('a short name keeps the full size and the native sign width', () => {
    const fit = fitSign(measure, 'api', box, 30, 6)
    expect(fit.lines).toEqual(['api'])
    expect(fit.size).toBeCloseTo(box.h * SIGN_SIZE_MAX)
    expect(fit.growW).toBe(0)
    expect(fit.growH).toBe(0)
  })

  it('claude-code-monitor widens the sign instead of shrinking or cutting', () => {
    const fit = fitSign(measure, 'claude-code-monitor', box, 0.6 * 50, 6)
    expect(fit.lines).toEqual(['claude-code-monitor'])
    expect(fit.size).toBeCloseTo(box.h * SIGN_SIZE_MAX)
    expect(fit.growW).toBeGreaterThan(0)
    expect(fit.growW).toBeLessThanOrEqual(30)
    expect(measure(fit.font, fit.lines[0]!)).toBeLessThanOrEqual(box.w - 2 * box.h * 0.3 + fit.growW + 1e-9)
  })

  it('with no spare wall the name shrinks to the readable floor, then wraps to two lines', () => {
    const fit = fitSign(measure, 'claude-code-monitor', box, 0, 8)
    expect(fit.lines).toEqual(['claude-code-', 'monitor'])
    expect(fit.size).toBeGreaterThanOrEqual(box.h * SIGN_SIZE_MIN - 1e-9)
    expect(fit.growH).toBeCloseTo(fit.size * SIGN_LINE)
    expect(fit.growW).toBe(0)
  })

  it('with no room at all it falls back to one ellipsized line at the readable size', () => {
    const fit = fitSign(measure, 'claude-code-monitor', box, 0, 0)
    expect(fit.lines).toHaveLength(1)
    expect(fit.lines[0]!.endsWith('…')).toBe(true)
    expect(fit.size).toBeCloseTo(box.h * SIGN_SIZE_READ)
  })

  it('splits on separators and camel case, else on the middle', () => {
    const w = (s: string) => s.length
    expect(splitName('claude-code-monitor', w)).toEqual(['claude-code-', 'monitor'])
    expect(splitName('my project name', w)).toEqual(['my project', 'name'])
    expect(splitName('OrreryMonitorApp', w)).toEqual(['Orrery', 'MonitorApp'])
    expect(splitName('abcdef', w)).toEqual(['abc', 'def'])
    expect(splitName('a', w)).toBeNull()
  })

  it('ellipsize keeps whole characters and fits', () => {
    const font = '600 10.00px x'
    const cut = ellipsize(measure, font, 'Nhà vệ sinh chung', 40)
    expect(cut.endsWith('…')).toBe(true)
    expect(measure(font, cut)).toBeLessThanOrEqual(40)
    expect(ellipsize(measure, font, 'ok', 40)).toBe('ok')
  })

  it('two lines are centred on the sign box', () => {
    const ys = signLineYs({ lines: ['a', 'b'], size: 10 }, 50, 1)
    expect(ys[0]! + ys[1]!).toBeCloseTo(2 * 51)
    expect(ys[1]! - ys[0]!).toBeCloseTo(10 * SIGN_LINE)
  })
})

describe('iso wall sign stretch', () => {
  it('spare width stops at the nearest neighbour and the wall ends', () => {
    expect(signSpare({ x0: 100, x1: 125 }, { x0: 0, x1: 300 }, [{ x0: 60, x1: 90 }, { x0: 160, x1: 190 }], 3)).toBe(14)
    expect(signSpare({ x0: 100, x1: 125 }, { x0: 95, x1: 300 }, [], 3)).toBe(4)
    expect(signSpare({ x0: 100, x1: 125 }, { x0: 0, x1: 300 }, [{ x0: 110, x1: 115 }, { x0: 140, x1: 150 }], 3)).toBe(24)
    expect(signSpare({ x0: 100, x1: 125 }, { x0: 0, x1: 300 }, [{ x0: 96, x1: 99 }], 3)).toBe(0)
  })

  it('nine-slice keeps the frame borders and grows only the middle', () => {
    const img = { w: 100, h: 92 }
    const dst = { x: 10, y: 20, w: 25, h: 30.67 }
    const parts = nineSlice(img, [8, 7, 81, 17], dst, 12, 4)
    expect(parts).toHaveLength(9)
    const k = dst.w / img.w
    const ky = dst.h / img.h
    expect(parts[0]).toMatchObject({ sx: 0, sy: 0, sw: 8, sh: 7 })
    expect(parts[0]!.dx).toBeCloseTo(10 - 6)
    expect(parts[0]!.dw).toBeCloseTo(8 * k)
    expect(parts[1]!.dw).toBeCloseTo(81 * k + 12)
    expect(parts[2]!.dw).toBeCloseTo(11 * k)
    expect(parts[2]!.dx + parts[2]!.dw).toBeCloseTo(10 + 25 + 6)
    expect(parts[4]!.dh).toBeCloseTo(17 * ky + 4)
    expect(parts[8]!.dy + parts[8]!.dh).toBeCloseTo(20 + dst.h + 4)
    const plain = nineSlice(img, [8, 7, 81, 17], dst, 0, 0)
    expect(plain[8]!.dx + plain[8]!.dw).toBeCloseTo(35)
  })
})
