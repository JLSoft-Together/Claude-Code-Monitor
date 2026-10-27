export const LIVE_RES = 2
export const LIVE_MAX = 320
export const SHEEN_ALPHA = 0.14
export const LIVE_REFRESH_MS = 150

export interface LiveRect {
  x: number
  y: number
  w: number
  h: number
}

export function liveGrid(viewW: number, viewH: number, res = LIVE_RES): { w: number; h: number } {
  const fit = (v: number) => (Number.isFinite(v) ? Math.max(1, Math.min(LIVE_MAX, Math.round(v * res))) : 1)
  return { w: fit(viewW), h: fit(viewH) }
}

export type LivePaint = (g: CanvasRenderingContext2D, r: LiveRect) => void

interface LiveSlot {
  canvas: HTMLCanvasElement | OffscreenCanvas
  g: CanvasRenderingContext2D
  bmp: ImageBitmap | null
  w: number
  h: number
  at: number
}

export class LiveScreens {
  private canvas: HTMLCanvasElement | null = null
  private g: CanvasRenderingContext2D | null = null
  private failed = false
  private slots = new WeakMap<object, LiveSlot>()

  private slot(owner: object, w: number, h: number): LiveSlot | null {
    let s = this.slots.get(owner)
    if (!s) {
      if (this.failed) return null
      let canvas: HTMLCanvasElement | OffscreenCanvas
      let g: CanvasRenderingContext2D | null
      try {
        canvas = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1)
        g = canvas.getContext('2d') as CanvasRenderingContext2D | null
      } catch {
        g = null
      }
      if (!g) {
        this.failed = true
        return null
      }
      s = { canvas: canvas!, g, bmp: null, w: 0, h: 0, at: -Infinity }
      this.slots.set(owner, s)
    }
    if (s.w !== w || s.h !== h) {
      s.canvas.width = s.w = w
      s.canvas.height = s.h = h
      s.at = -Infinity
    }
    return s
  }

  private render(g: CanvasRenderingContext2D, w: number, h: number, draw: LivePaint): void {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, w, h)
    g.imageSmoothingEnabled = false
    g.save()
    g.beginPath()
    g.rect(0, 0, w, h)
    g.clip()
    try {
      draw(g, { x: 0, y: 0, w, h })
    } finally {
      g.restore()
    }
  }

  private blit(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, dst: LiveRect, sheen: boolean): void {
    const was = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(src, 0, 0, w, h, dst.x, dst.y, dst.w, dst.h)
    ctx.imageSmoothingEnabled = was
    if (!sheen) return
    const grad = ctx.createLinearGradient(dst.x, dst.y, dst.x, dst.y + dst.h)
    grad.addColorStop(0, `rgba(255,255,255,${SHEEN_ALPHA})`)
    grad.addColorStop(0.5, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(dst.x, dst.y, dst.w, dst.h)
  }

  paintCached(ctx: CanvasRenderingContext2D, owner: object, now: number, dst: LiveRect, viewW: number, viewH: number, draw: LivePaint, sheen = true): void {
    const grid = liveGrid(viewW, viewH)
    const s = this.slot(owner, grid.w, grid.h)
    if (!s) return this.paint(ctx, dst, viewW, viewH, draw, sheen)
    if (now - s.at >= LIVE_REFRESH_MS || now < s.at) {
      this.render(s.g, grid.w, grid.h, draw)
      s.at = now
      if ('transferToImageBitmap' in s.canvas) {
        s.bmp?.close()
        s.bmp = s.canvas.transferToImageBitmap()
      }
    }
    this.blit(ctx, s.bmp ?? s.canvas, grid.w, grid.h, dst, sheen)
  }

  private scratch(w: number, h: number): CanvasRenderingContext2D | null {
    if (this.failed) return null
    if (!this.canvas) {
      try {
        this.canvas = document.createElement('canvas')
        this.g = this.canvas.getContext('2d')
      } catch {
        this.g = null
      }
      if (!this.g) {
        this.failed = true
        return null
      }
    }
    const c = this.canvas!
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w)
      c.height = Math.max(c.height, h)
    }
    return this.g
  }

  paint(ctx: CanvasRenderingContext2D, dst: LiveRect, viewW: number, viewH: number, draw: LivePaint, sheen = true): void {
    const grid = liveGrid(viewW, viewH)
    const g = this.scratch(grid.w, grid.h)
    if (!g || !this.canvas) {
      draw(ctx, dst)
      return
    }
    this.render(g, grid.w, grid.h, draw)
    this.blit(ctx, this.canvas, grid.w, grid.h, dst, sheen)
  }
}
