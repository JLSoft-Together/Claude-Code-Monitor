import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadIso, OFFICE_STYLE_KEY, readOfficeStyle, writeOfficeStyle } from './index'
import { resetIsoArt } from './isoArt'
import { isoProjection } from './projection'

afterEach(() => {
  localStorage.clear()
  resetIsoArt()
  vi.unstubAllGlobals()
})

describe('iso dev flag', () => {
  it('reads pixel unless the key is exactly iso', () => {
    expect(readOfficeStyle()).toBe('pixel')
    localStorage.setItem(OFFICE_STYLE_KEY, 'ISO')
    expect(readOfficeStyle()).toBe('pixel')
    localStorage.setItem(OFFICE_STYLE_KEY, 'iso')
    expect(readOfficeStyle()).toBe('iso')
  })

  it('falls back to pixel without storage or when storage throws', () => {
    expect(readOfficeStyle(null)).toBe('pixel')
    expect(
      readOfficeStyle({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toBe('pixel')
  })

  it('loads nothing for the pixel style', async () => {
    expect(await loadIso('pixel')).toBeNull()
    expect(await loadIso()).toBeNull()
  })

  it('loads the projection, the renderer factory and the 3D art for iso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    localStorage.setItem(OFFICE_STYLE_KEY, 'iso')
    const kit = await loadIso()
    expect(kit?.projection).toBe(isoProjection)
    expect(kit?.createRenderer).toBeTypeOf('function')
    expect((await kit!.art).missing).toBe(true)
  })

  it('writes the style and survives blocked storage', () => {
    writeOfficeStyle('iso')
    expect(readOfficeStyle()).toBe('iso')
    writeOfficeStyle('pixel')
    expect(readOfficeStyle()).toBe('pixel')
    expect(() =>
      writeOfficeStyle('iso', {
        setItem: () => {
          throw new Error('blocked')
        },
      }),
    ).not.toThrow()
  })
})
