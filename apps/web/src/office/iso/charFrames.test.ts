import { describe, expect, it } from 'vitest'
import { CharFrames, frameBucket, type MakeFrame } from './charFrames'
import type { IsoImage } from './isoArt'

const sheet = (): IsoImage => ({ src: {} as CanvasImageSource, w: 1536, h: 4576 })
const fakeBitmap = (w: number, h: number): ImageBitmap => ({ width: w, height: h, close: () => undefined }) as ImageBitmap

function maker() {
  const jobs: { w: number; h: number; resolve: () => void }[] = []
  const make: MakeFrame = (_src, _sx, _sy, _sw, _sh, w, h) =>
    new Promise<ImageBitmap>((resolve) => jobs.push({ w, h, resolve: () => resolve(fakeBitmap(w, h)) }))
  return { make, jobs }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('CharFrames', () => {
  it('buckets device heights up to 8 px steps with a floor', () => {
    expect(frameBucket(3)).toBe(16)
    expect(frameBucket(57)).toBe(64)
    expect(frameBucket(64)).toBe(64)
  })

  it('returns nothing until the scaled frame is ready, then the cached bitmap', async () => {
    const { make, jobs } = maker()
    const f = new CharFrames(make)
    const s = sheet()
    expect(f.get(s, 192, 352, 192, 352, 60)).toBeNull()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ h: 64, w: 35 })
    expect(f.get(s, 192, 352, 192, 352, 61)).toBeNull()
    expect(jobs).toHaveLength(1)
    jobs[0]!.resolve()
    await flush()
    expect(f.get(s, 192, 352, 192, 352, 60)?.height).toBe(64)
  })

  it('falls back to another size of the same frame while a new size builds', async () => {
    const { make, jobs } = maker()
    const f = new CharFrames(make)
    const s = sheet()
    f.get(s, 0, 0, 192, 352, 60)
    jobs[0]!.resolve()
    await flush()
    expect(f.get(s, 0, 0, 192, 352, 120)?.height).toBe(64)
    expect(jobs).toHaveLength(2)
    expect(f.get(s, 192, 0, 192, 352, 120)).toBeNull()
  })

  it('caps parallel builds and evicts least recently used frames', async () => {
    const { make, jobs } = maker()
    const f = new CharFrames(make, 2, 1)
    const s = sheet()
    f.get(s, 0, 0, 192, 352, 60)
    f.get(s, 192, 0, 192, 352, 60)
    expect(jobs).toHaveLength(1)
    jobs[0]!.resolve()
    await flush()
    f.get(s, 192, 0, 192, 352, 60)
    jobs[1]!.resolve()
    await flush()
    f.get(s, 384, 0, 192, 352, 60)
    jobs[2]!.resolve()
    await flush()
    expect(f.size).toBe(2)
    expect(f.get(s, 384, 0, 192, 352, 60)).not.toBeNull()
  })

  it('clear drops frames and ignores builds still in flight', async () => {
    const { make, jobs } = maker()
    const f = new CharFrames(make)
    const s = sheet()
    f.get(s, 0, 0, 192, 352, 60)
    f.clear()
    jobs[0]!.resolve()
    await flush()
    expect(f.size).toBe(0)
  })

  it('without createImageBitmap stays on the sheet', () => {
    const f = new CharFrames(() => null)
    expect(f.get(sheet(), 0, 0, 192, 352, 60)).toBeNull()
    expect(f.size).toBe(0)
  })
})
