import type { IsoImage } from './isoArt'

export const FRAME_STEP_PX = 8
export const FRAME_MIN_PX = 16
export const FRAME_CACHE_MAX = 900
export const FRAME_BUILDS_MAX = 24

export type MakeFrame = (src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number) => Promise<ImageBitmap> | null

interface Entry {
  bmp: ImageBitmap | null
  used: number
  frame: string
}

export const defaultMakeFrame: MakeFrame = (src, sx, sy, sw, sh, w, h) => {
  if (typeof createImageBitmap !== 'function') return null
  try {
    return createImageBitmap(src as ImageBitmapSource, sx, sy, sw, sh, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'premultiply' })
  } catch {
    return null
  }
}

export const frameBucket = (devH: number): number => Math.max(FRAME_MIN_PX, Math.ceil(devH / FRAME_STEP_PX) * FRAME_STEP_PX)

export class CharFrames {
  private sheetIds = new WeakMap<IsoImage, number>()
  private nextSheet = 0
  private entries = new Map<string, Entry>()
  private ready = new Map<string, Entry>()
  private building = 0
  private gen = 0
  private tick = 0

  constructor(
    private readonly make: MakeFrame = defaultMakeFrame,
    private readonly max = FRAME_CACHE_MAX,
    private readonly buildsMax = FRAME_BUILDS_MAX,
  ) {}

  get size(): number {
    return this.entries.size
  }

  private idOf(sheet: IsoImage): number {
    let sid = this.sheetIds.get(sheet)
    if (sid === undefined) this.sheetIds.set(sheet, (sid = this.nextSheet++))
    return sid
  }

  get(sheet: IsoImage, sx: number, sy: number, fw: number, fh: number, devH: number, family: IsoImage = sheet): ImageBitmap | null {
    if (!(devH > 0) || !Number.isFinite(devH)) return null
    const h = frameBucket(devH)
    const frame = `${this.idOf(family)}|${sx},${sy}`
    const key = `${frame}|${h}|${this.idOf(sheet)}`
    const tick = ++this.tick
    const hit = this.entries.get(key)
    if (hit) {
      hit.used = tick
      if (hit.bmp) return hit.bmp
    } else if (this.building < this.buildsMax) this.start(sheet, sx, sy, fw, fh, h, frame, key, tick)
    const near = this.ready.get(frame)
    if (near?.bmp) near.used = tick
    return near?.bmp ?? null
  }

  clear(): void {
    for (const e of this.entries.values()) e.bmp?.close?.()
    this.entries.clear()
    this.ready.clear()
    this.building = 0
    this.gen++
  }

  private start(sheet: IsoImage, sx: number, sy: number, fw: number, fh: number, h: number, frame: string, key: string, tick: number): void {
    const w = Math.max(1, Math.round((fw * h) / fh))
    const k = sheet.k ?? 1
    const job = this.make(sheet.src, sx * k, sy * k, fw * k, fh * k, w, h)
    if (!job) return
    const entry: Entry = { bmp: null, used: tick, frame }
    this.entries.set(key, entry)
    this.building++
    const gen = this.gen
    job.then(
      (bmp) => {
        if (gen !== this.gen) return bmp.close?.()
        this.building--
        if (this.entries.get(key) !== entry) return bmp.close?.()
        entry.bmp = bmp
        this.ready.set(frame, entry)
        this.trim()
      },
      () => {
        if (gen !== this.gen) return
        this.building--
      },
    )
  }

  private trim(): void {
    if (this.entries.size <= this.max) return
    const done = [...this.entries].filter(([, e]) => e.bmp).sort((a, b) => a[1].used - b[1].used)
    for (const [key, e] of done.slice(0, this.entries.size - this.max)) {
      this.entries.delete(key)
      if (this.ready.get(e.frame) === e) this.ready.delete(e.frame)
      e.bmp?.close?.()
    }
  }
}
