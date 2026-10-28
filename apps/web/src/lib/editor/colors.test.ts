import { describe, expect, it } from 'vitest'
import { cssColor, findColors, fromInputHex, parseHex, parseRgbArgs, replaceRgb, toInputHex } from './colors'

const red = { r: 255, g: 0, b: 0 }

describe('parse', () => {
  it('reads CSS hex with alpha last and Android hex with alpha first', () => {
    expect(parseHex('f00', false)).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseHex('ff000080', false)).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 })
    expect(parseHex('80ff0000', true)).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 })
    expect(parseHex('8f00', true)).toEqual({ r: 255, g: 0, b: 0, a: 0x88 / 255 })
  })

  it('reads rgb() in comma and space syntax', () => {
    expect(parseRgbArgs('255, 0, 0')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseRgbArgs('255,0,0,0.5')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseRgbArgs('100% 0% 0% / 50%')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseRgbArgs('var(--x)')).toBeNull()
    expect(parseRgbArgs('${r}, 0, 0')).toBeNull()
  })
})

describe('findColors', () => {
  it('finds hex, rgb() and Flutter literals with offsets', () => {
    const text = 'a { color: #fff; background: rgba(0, 0, 0, .5) } Color(0xFF2196F3)'
    const found = findColors(text, 'css')
    expect(found.map((c) => c.text)).toEqual(['#fff', 'rgba(0, 0, 0, .5)', 'Color(0xFF2196F3)'])
    for (const c of found) expect(text.slice(c.from, c.to)).toBe(c.text)
    expect(found[2]!.color).toEqual({ r: 0x21, g: 0x96, b: 0xf3, a: 1 })
  })

  it('reads 8-digit hex by file type', () => {
    expect(findColors('<color name="x">#80FF0000</color>', 'xml')[0]!.color.a).toBeCloseTo(128 / 255)
    expect(findColors('color: #FF000080;', 'css')[0]!.color).toMatchObject({ r: 255, g: 0, b: 0 })
  })

  it('skips things that only look like colours', () => {
    expect(findColors('#define X', 'c')).toEqual([])
    expect(findColors('&#123; a#bad this.#fade', 'html')).toEqual([])
    expect(findColors('#abcde #1234567', 'css')).toEqual([])
    expect(findColors('fixes #123 and #4567', 'markdown')).toEqual([])
    expect(findColors('color #000', 'css')).toHaveLength(1)
  })
})

describe('replaceRgb', () => {
  it('keeps hex length, case and alpha', () => {
    expect(replaceRgb('#abc', red, 'css')).toBe('#f00')
    expect(replaceRgb('#abc', { r: 0x12, g: 0x34, b: 0x56 }, 'css')).toBe('#123456')
    expect(replaceRgb('#abc8', { r: 0x12, g: 0x34, b: 0x56 }, 'css')).toBe('#12345688')
    expect(replaceRgb('#AABBCC80', red, 'css')).toBe('#FF000080')
    expect(replaceRgb('#80AABBCC', red, 'xml')).toBe('#80FF0000')
    expect(replaceRgb('#8abc', red, 'xml')).toBe('#8f00')
  })

  it('keeps rgb() separators, units and alpha', () => {
    expect(replaceRgb('rgba(1, 2, 3, 0.4)', red, 'css')).toBe('rgba(255, 0, 0, 0.4)')
    expect(replaceRgb('rgb(1 2 3 / 40%)', red, 'css')).toBe('rgb(255 0 0 / 40%)')
    expect(replaceRgb('rgb(10%,20%,30%)', red, 'css')).toBe('rgb(100%,0%,0%)')
  })

  it('keeps the Flutter alpha byte', () => {
    expect(replaceRgb('Color(0x802196F3)', red, 'dart')).toBe('Color(0x80FF0000)')
    expect(replaceRgb('Color(0xff2196f3)', red, 'dart')).toBe('Color(0xffff0000)')
  })
})

describe('input helpers', () => {
  it('round-trips the colour input value', () => {
    expect(toInputHex({ r: 255, g: 8, b: 0, a: 0.5 })).toBe('#ff0800')
    expect(fromInputHex('#ff0800')).toEqual({ r: 255, g: 8, b: 0 })
    expect(fromInputHex('red')).toBeNull()
    expect(cssColor({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgb(1 2 3 / 0.5)')
  })
})
