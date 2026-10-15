import { describe, expect, it } from 'vitest'
import { tokenizePacked } from './highlightCore'
import { unpackTokens } from './highlight'
import { maxColumns, prefixOffsets, rowAtOffset, uniformRange, windowRange } from './rowWindow'

describe('row window', () => {
  it('covers the viewport plus overscan, snapped to chunks', () => {
    const r = uniformRange(10_000, 20, 50_000, 600)
    expect(r.start).toBeLessThanOrEqual(Math.floor((50_000 - 1200) / 20))
    expect(r.end).toBeGreaterThanOrEqual(Math.ceil((50_600 + 1200) / 20))
    expect(r.start % 64).toBe(0)
    expect(uniformRange(10_000, 20, 50_010, 600)).toEqual(r)
    expect(uniformRange(100, 20, 0, 600)).toEqual({ start: 0, end: 100 })
    expect(uniformRange(10_000, 20, 1e9, 600).end).toBe(10_000)
  })

  it('maps offsets of mixed row heights', () => {
    const kinds = ['row', 'fold', 'row', 'gap', 'row']
    const h: Record<string, number> = { row: 20, fold: 24, gap: 30 }
    const offs = prefixOffsets(kinds.length, (i) => h[kinds[i]!]!)
    expect([...offs]).toEqual([0, 20, 44, 64, 94, 114])
    expect(rowAtOffset(offs, 0)).toBe(0)
    expect(rowAtOffset(offs, 50)).toBe(2)
    expect(rowAtOffset(offs, 1000)).toBe(4)
    expect(windowRange(offs, 0, 100)).toEqual({ start: 0, end: 5 })
  })

  it('measures the widest line with tabs', () => {
    expect(maxColumns(['ab', '\tx', 'a\tb'])).toBe(5)
  })
})

describe('packed tokens', () => {
  it('round-trips shiki tokens through the transferable form', async () => {
    const code = 'const a = 1\r\n// note\nlet b = "x"'
    const packed = await tokenizePacked(code, 'typescript')
    expect(packed).not.toBeNull()
    const lines = unpackTokens(code, packed!)!
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.map((t) => t.content).join(''))).toEqual(['const a = 1', '// note', 'let b = "x"'])
    expect(lines[0]!.some((t) => t.color?.startsWith('var(--shiki'))).toBe(true)
    expect(unpackTokens('one line', packed!)).toBeNull()
  })
})
