export interface PathSamples {
  xs: Float32Array
  ys: Float32Array
}

type Geometry = Pick<SVGGeometryElement, 'getTotalLength' | 'getPointAtLength'>

/**
 * Reads a path's geometry once, so a runner animating along it never touches the DOM per frame
 * (interleaved with Vue's writes, each `getPointAtLength` forced a style recalc of the whole app).
 */
export function samplePath(el: Geometry, count = 48): PathSamples | null {
  const len = el.getTotalLength()
  if (!len) return null
  const xs = new Float32Array(count + 1)
  const ys = new Float32Array(count + 1)
  for (let i = 0; i <= count; i++) {
    const p = el.getPointAtLength((len * i) / count)
    xs[i] = p.x
    ys[i] = p.y
  }
  return { xs, ys }
}

export function pointAt(s: PathSamples, f: number): { x: number; y: number } {
  const n = s.xs.length - 1
  const t = Math.min(1, Math.max(0, f)) * n
  const i = Math.min(n - 1, Math.floor(t))
  const k = t - i
  return { x: s.xs[i]! + (s.xs[i + 1]! - s.xs[i]!) * k, y: s.ys[i]! + (s.ys[i + 1]! - s.ys[i]!) * k }
}
