export const LIVE_RES = 2
export const LIVE_MAX = 320
export const SHEEN_ALPHA = 0.14

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

export class LiveScreens {
  private canvas: HTMLCanvasElement | null = null
  private g: CanvasRenderingContext2D | null = null
  private failed = false

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
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, grid.w, grid.h)
    g.imageSmoothingEnabled = false
    g.save()
    g.beginPath()
    g.rect(0, 0, grid.w, grid.h)
    g.clip()
    try {
      draw(g, { x: 0, y: 0, w: grid.w, h: grid.h })
    } finally {
      g.restore()
    }
    const was = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.canvas, 0, 0, grid.w, grid.h, dst.x, dst.y, dst.w, dst.h)
    ctx.imageSmoothingEnabled = was
    if (!sheen) return
    const grad = ctx.createLinearGradient(dst.x, dst.y, dst.x, dst.y + dst.h)
    grad.addColorStop(0, `rgba(255,255,255,${SHEEN_ALPHA})`)
    grad.addColorStop(0.5, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(dst.x, dst.y, dst.w, dst.h)
  }
}
