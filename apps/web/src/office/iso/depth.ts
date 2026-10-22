export interface DepthBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ScreenBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function behind(a: DepthBox, b: DepthBox): boolean {
  return a.maxX <= b.minX || a.maxY <= b.minY
}

export type DepthWeights = readonly [number, number]

export const EVEN: DepthWeights = [1, 1]

export function centreSum(a: DepthBox, w: DepthWeights = EVEN): number {
  return (w[0] * (a.minX + a.maxX) + w[1] * (a.minY + a.maxY)) / 2
}

export function compareDepth(a: DepthBox, b: DepthBox, w: DepthWeights = EVEN): number {
  const ab = behind(a, b)
  const ba = behind(b, a)
  if (ab && !ba) return -1
  if (ba && !ab) return 1
  return centreSum(a, w) - centreSum(b, w)
}

export function screenOverlap(a: ScreenBox, b: ScreenBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
}

export interface Sortable {
  box: DepthBox
  screen: ScreenBox
}

export function topoSort<T extends Sortable>(items: readonly T[], w: DepthWeights = EVEN): T[] {
  const n = items.length
  const out: number[][] = Array.from({ length: n }, () => [])
  const indeg = new Array<number>(n).fill(0)
  const keys = items.map((it) => centreSum(it.box, w))
  for (let i = 0; i < n; i++) {
    const a = items[i]!
    for (let j = i + 1; j < n; j++) {
      const b = items[j]!
      if (!screenOverlap(a.screen, b.screen)) continue
      const c = compareDepth(a.box, b.box, w)
      if (c < 0) {
        out[i]!.push(j)
        indeg[j]!++
      } else if (c > 0) {
        out[j]!.push(i)
        indeg[i]!++
      }
    }
  }
  const done = new Array<boolean>(n).fill(false)
  const order: T[] = []
  const ready: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i)
  while (order.length < n) {
    let pickAt = -1
    for (let k = 0; k < ready.length; k++) if (pickAt < 0 || keys[ready[k]!]! < keys[ready[pickAt]!]!) pickAt = k
    let i: number
    if (pickAt >= 0) {
      i = ready[pickAt]!
      ready.splice(pickAt, 1)
    } else {
      i = -1
      for (let k = 0; k < n; k++) if (!done[k] && (i < 0 || keys[k]! < keys[i]!)) i = k
    }
    if (done[i]) continue
    done[i] = true
    order.push(items[i]!)
    for (const j of out[i]!) {
      indeg[j]!--
      if (indeg[j] === 0 && !done[j]) ready.push(j)
    }
  }
  return order
}

export interface Placed {
  box: DepthBox
  screen: ScreenBox
  rank: number
}

export function insertRank(statics: readonly Placed[], box: DepthBox, screen: ScreenBox, floor = -1): number {
  let lo = floor
  let hi = Infinity
  for (const s of statics) {
    if (!screenOverlap(s.screen, screen)) continue
    if (behind(s.box, box) && !behind(box, s.box)) lo = Math.max(lo, s.rank)
    else if (behind(box, s.box) && !behind(s.box, box)) hi = Math.min(hi, s.rank)
  }
  if (hi <= lo && hi > floor) return hi - 0.5
  return lo + 0.5
}
