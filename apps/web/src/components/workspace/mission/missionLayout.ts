export interface MissionLayoutSpec {
  width: number
  height: number
  counts: readonly number[]
  aspect: number
  head: number
  gap: number
  sectionHead: number
  sectionGap: number
  min: number
  max: number
}

export interface MissionLayout {
  cardW: number
  bodyH: number
  cols: number[]
  contentW: number
  fits: boolean
}

export const ASPECT_RANGE = { min: 1.1, max: 2.4 } as const

export function bodyAspect(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1.6
  return Math.min(ASPECT_RANGE.max, Math.max(ASPECT_RANGE.min, width / height))
}

const SEARCH_STEPS = 28

export function missionLayout(spec: MissionLayoutSpec): MissionLayout {
  const W = Math.max(1, spec.width)
  const counts = spec.counts.filter((n) => n > 0)
  const maxW = Math.max(1, Math.min(spec.max, W))
  const minW = Math.max(1, Math.min(spec.min, maxW))
  const colsAt = (w: number, n: number): number => Math.max(1, Math.min(n, Math.floor((W + spec.gap) / (w + spec.gap))))
  const heightAt = (w: number): number => {
    const card = spec.head + w / spec.aspect
    return counts.reduce((sum, n, i) => {
      const rows = Math.ceil(n / colsAt(w, n))
      return sum + spec.sectionHead + rows * card + (rows - 1) * spec.gap + (i ? spec.sectionGap : 0)
    }, 0)
  }
  let w: number
  let fits = true
  if (!counts.length || heightAt(maxW) <= spec.height) w = maxW
  else if (heightAt(minW) > spec.height) {
    fits = false
    const cols = Math.max(1, Math.floor((W + spec.gap) / (minW + spec.gap)))
    w = Math.min(maxW, Math.max(minW, (W - (cols - 1) * spec.gap) / cols))
  } else {
    let lo = minW
    let hi = maxW
    for (let i = 0; i < SEARCH_STEPS && hi - lo > 0.25; i++) {
      const mid = (lo + hi) / 2
      if (heightAt(mid) <= spec.height) lo = mid
      else hi = mid
    }
    w = lo
  }
  const cardW = Math.max(1, Math.floor(w))
  const cols = spec.counts.map((n) => colsAt(cardW, Math.max(1, n)))
  const contentW = cols.reduce((most, c) => Math.max(most, c * cardW + (c - 1) * spec.gap), 0)
  return { cardW, bodyH: Math.max(1, Math.floor(cardW / spec.aspect)), cols, contentW: contentW || cardW, fits }
}

export interface TileMetrics {
  inset: number
  gap: number
  head: number
  pad: number
  line: number
}

export function tileRows(bodyH: number, boxH: number, m: TileMetrics, cap = Infinity): number {
  const tile = (bodyH - 2 * m.inset) * boxH - 2 * m.gap
  const room = tile - m.head - m.pad
  return Math.max(1, Math.min(cap, Math.ceil(room / m.line)))
}

export function tailLines(text: string, rows: number): string {
  if (!text) return ''
  const lines = text.split('\n')
  return lines.length <= rows ? text : lines.slice(-rows).join('\n')
}
