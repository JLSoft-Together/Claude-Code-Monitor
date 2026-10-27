export function snapshot(src: HTMLCanvasElement | OffscreenCanvas): ImageBitmap | null {
  if (typeof OffscreenCanvas === 'undefined' || src.width < 1 || src.height < 1) return null
  try {
    const o = new OffscreenCanvas(src.width, src.height)
    const g = o.getContext('2d')
    if (!g) return null
    g.drawImage(src, 0, 0)
    return o.transferToImageBitmap()
  } catch {
    return null
  }
}

export function frozen(src: CanvasImageSource): CanvasImageSource {
  if (typeof HTMLCanvasElement === 'undefined' || !(src instanceof HTMLCanvasElement)) return src
  return snapshot(src) ?? src
}

const once = new WeakMap<object, CanvasImageSource>()

export function frozenOnce(src: CanvasImageSource): CanvasImageSource {
  let hit = once.get(src)
  if (!hit) {
    hit = frozen(src)
    once.set(src, hit)
  }
  return hit
}
