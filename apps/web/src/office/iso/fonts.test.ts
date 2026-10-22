import { afterEach, describe, expect, it, vi } from 'vitest'
import { ISO_FONT_FAMILY, ISO_FONT_NAME, ISO_TEXT, loadIsoFonts, resetIsoFontsForTest, waitIsoFonts } from './fonts'

afterEach(() => {
  resetIsoFontsForTest()
  vi.useRealTimers()
})

describe('iso fonts', () => {
  it('uses the bundled Be Vietnam Pro first, then the system stack, with padding for the overlay', () => {
    expect(ISO_FONT_FAMILY.startsWith(`"${ISO_FONT_NAME}"`)).toBe(true)
    expect(ISO_FONT_FAMILY).toContain('system-ui')
    expect(ISO_TEXT).toEqual({ family: ISO_FONT_FAMILY, padX: 8, padY: 4, declutter: true, iconLift: 6 })
  })

  it('loads weights 500 and 600 once, with Vietnamese sample text', async () => {
    const load = vi.fn(async () => [] as FontFace[])
    await loadIsoFonts({ load })
    await loadIsoFonts({ load })
    expect(load).toHaveBeenCalledTimes(2)
    expect(load.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([`500 12px "${ISO_FONT_NAME}"`, `600 12px "${ISO_FONT_NAME}"`])
    expect((load.mock.calls[0] as unknown as [string, string])[1]).toContain('Đ')
  })

  it('never rejects and does not wait forever', async () => {
    await expect(loadIsoFonts({ load: () => Promise.reject(new Error('x')) })).resolves.toBeUndefined()
    resetIsoFontsForTest()
    vi.useFakeTimers()
    const p = waitIsoFonts({ load: () => new Promise<FontFace[]>(() => {}) }, 100)
    vi.advanceTimersByTime(100)
    await expect(p).resolves.toBeUndefined()
    await expect(loadIsoFonts(null)).resolves.toBeUndefined()
  })
})
