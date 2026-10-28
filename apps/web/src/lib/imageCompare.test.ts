import { describe, expect, it } from 'vitest'
import { clampPercent, imageSides, isImagePath, readMode } from './imageCompare'

describe('imageCompare', () => {
  it('knows image paths', () => {
    expect(['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg', 'g.bmp'].every(isImagePath)).toBe(true)
    expect(['a.ts', 'png', 'a.png.txt', 'a.tiff'].some(isImagePath)).toBe(false)
  })

  it('picks the sides by change kind', () => {
    expect(imageSides({ kind: 'modified', path: 'a.png' })).toEqual({ old: 'a.png', new: true })
    expect(imageSides({ kind: 'added', path: 'a.png' })).toEqual({ old: null, new: true })
    expect(imageSides({ kind: 'untracked', path: 'a.png' })).toEqual({ old: null, new: true })
    expect(imageSides({ kind: 'deleted', path: 'a.png' })).toEqual({ old: 'a.png', new: false })
    expect(imageSides({ kind: 'renamed', path: 'b.png', origPath: 'a.png' })).toEqual({ old: 'a.png', new: true })
  })

  it('clamps and reads stored values', () => {
    expect(clampPercent(-3)).toBe(0)
    expect(clampPercent(140)).toBe(100)
    expect(clampPercent(Number.NaN)).toBe(50)
    expect(readMode('onion')).toBe('onion')
    expect(readMode('x')).toBe('side')
    expect(readMode(null)).toBe('side')
  })
})
