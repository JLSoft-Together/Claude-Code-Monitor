export interface RailDragSource {
  kind: 'pane' | 'tab'
  paneKey: string | null
  tabKey: string
  cluster: string
  title: string
  detachable: boolean
}

export interface RailDropSpot {
  tabKey: string
  cluster: string
  top: number
  bottom: number
}

export interface RailClusterBox {
  key: string
  top: number
  bottom: number
}

export type RailDropAim = { type: 'merge'; tabKey: string } | { type: 'detach'; y: number } | { type: 'blocked' } | null

export const DROP_EDGE = 6

function boundaries(spots: readonly RailDropSpot[]): number[] {
  if (!spots.length) return []
  const out = [spots[0]!.top]
  for (let i = 1; i < spots.length; i++) if (spots[i]!.tabKey !== spots[i - 1]!.tabKey) out.push((spots[i - 1]!.bottom + spots[i]!.top) / 2)
  out.push(spots.at(-1)!.bottom)
  return out
}

export function dropTarget(src: RailDragSource, y: number, clusters: readonly RailClusterBox[], spots: readonly RailDropSpot[]): RailDropAim {
  const box = clusters.find((c) => y >= c.top && y <= c.bottom)
  if (!box) return null
  if (box.key !== src.cluster) return { type: 'blocked' }
  const mine = spots.filter((s) => s.cluster === box.key && s.bottom - s.top >= 2).sort((a, b) => a.top - b.top)
  const edges = boundaries(mine)
  const spot = mine.find((s) => y >= s.top && y <= s.bottom)
  if (src.detachable) {
    const edge = edges.find((e) => Math.abs(y - e) <= DROP_EDGE)
    if (edge !== undefined) return { type: 'detach', y: edge }
    if (!spot) return { type: 'detach', y: edges.reduce((best, e) => (Math.abs(y - e) < Math.abs(y - best) ? e : best), edges[0] ?? y) }
  }
  if (spot && spot.tabKey !== src.tabKey) return { type: 'merge', tabKey: spot.tabKey }
  return null
}
