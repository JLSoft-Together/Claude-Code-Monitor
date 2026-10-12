import { describe, expect, it } from 'vitest'
import { autocompactBufferPct, contextUsedPct, usablePct } from '@ccm/shared'
import { parseStatusLine } from '../src/statusline'

describe('context percent like the status line', () => {
  it('scales the raw percent to the room before auto-compact', () => {
    expect(Math.round(contextUsedPct(306_010, 1_000_000))).toBe(37)
    expect(usablePct(90)).toBe(100)
    expect(usablePct(0)).toBe(0)
  })

  it('derives the buffer from CLAUDE_CODE_AUTO_COMPACT_WINDOW', () => {
    expect(autocompactBufferPct(undefined)).toBe(16.5)
    expect(autocompactBufferPct(0)).toBe(16.5)
    expect(autocompactBufferPct(200_000)).toBe(20)
    expect(autocompactBufferPct(200_000, 400_000)).toBe(50)
    expect(usablePct(40, 20)).toBe(50)
  })

  it('reads the reported percent and buffer from the bridge file', () => {
    const r = parseStatusLine(JSON.stringify({ sessionId: 's', at: '2026-10-10T00:00:00.000Z', contextPct: 30.6, bufferPct: 20 }))
    expect(r?.contextPct).toBe(30.6)
    expect(r?.bufferPct).toBe(20)
    expect(parseStatusLine(JSON.stringify({ sessionId: 's', at: '2026-10-10T00:00:00.000Z', contextPct: 140 }))?.contextPct).toBeUndefined()
  })
})
