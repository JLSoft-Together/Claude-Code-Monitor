import type { DesktopLook } from './desktop'

/** Any computed CSS colour (rgb(), color-mix results, alpha) flattened onto `base` → #rrggbb. */
function hexOf(ctx: CanvasRenderingContext2D, color: string, base: string): string {
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`
}

/** The active theme's chrome colours, for the desktop startup screen (it renders before the app's CSS exists). */
export function readLook(root: HTMLElement = document.documentElement): DesktopLook | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const probe = document.createElement('span')
    probe.style.display = 'none'
    root.appendChild(probe)
    const resolve = (token: string): string => {
      probe.style.color = `var(${token})`
      return getComputedStyle(probe).color
    }
    const bg = hexOf(ctx, resolve('--ccm-canvas'), '#000000')
    const look: DesktopLook = {
      canvas: bg,
      surface: hexOf(ctx, resolve('--ccm-surface'), bg),
      ink: hexOf(ctx, resolve('--ccm-ink'), bg),
      muted: hexOf(ctx, resolve('--ccm-ink-muted'), bg),
      faint: hexOf(ctx, resolve('--ccm-ink-faint'), bg),
      accent: hexOf(ctx, resolve('--ccm-accent'), bg),
      dark: root.classList.contains('dark'),
    }
    probe.remove()
    return look
  } catch {
    return null
  }
}
