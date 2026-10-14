// IntelliJ-style lanes over `git log --topo-order` rows. Lanes keep their column; freed columns are reused.
export interface CommitLink {
  hash: string
  parents: readonly string[]
}

/** One half-row segment: `top` = row top → node height, `bottom` = node height → row bottom. */
export interface GraphEdge {
  from: number
  to: number
  color: number
  half: 'top' | 'bottom'
}

export interface GraphRow {
  lane: number
  color: number
  edges: GraphEdge[]
  width: number
}

/** `lanes[i]` = hash the lane waits for (null = free column). */
export interface GraphState {
  lanes: (string | null)[]
  colors: number[]
  next: number
}

export const MAX_LANES = 30
export const emptyGraph = (): GraphState => ({ lanes: [], colors: [], next: 0 })
export const clampLane = (i: number): number => Math.min(i, MAX_LANES - 1)
export const flatRows = (n: number): GraphRow[] => Array.from({ length: n }, () => ({ lane: 0, color: 0, edges: [], width: 1 }))
export const graphWidth = (rows: readonly GraphRow[]): number => rows.reduce((w, r) => Math.max(w, r.width), 1)

const freeSlot = (lanes: (string | null)[]): number => {
  const i = lanes.indexOf(null)
  return i < 0 ? lanes.length : i
}

export function extendGraph(state: GraphState, commits: readonly CommitLink[]): { state: GraphState; rows: GraphRow[] } {
  const lanes = [...state.lanes]
  const colors = [...state.colors]
  let next = state.next
  const rows: GraphRow[] = []
  for (const commit of commits) {
    const edges: GraphEdge[] = []
    let lane = lanes.indexOf(commit.hash)
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) continue
      edges.push({ from: i, to: lanes[i] === commit.hash ? lane : i, color: colors[i]!, half: 'top' })
    }
    if (lane < 0) {
      lane = freeSlot(lanes)
      colors[lane] = next++
    }
    const color = colors[lane]!
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.hash) lanes[i] = null
    const [first, ...rest] = commit.parents
    const touched = new Set<number>()
    if (first !== undefined) {
      lanes[lane] = first
      edges.push({ from: lane, to: lane, color, half: 'bottom' })
      touched.add(lane)
    } else lanes[lane] = null
    for (const parent of rest) {
      let j = lanes.indexOf(parent)
      if (j < 0) {
        j = freeSlot(lanes)
        lanes[j] = parent
        colors[j] = next++
        touched.add(j)
      }
      edges.push({ from: lane, to: j, color: colors[j]!, half: 'bottom' })
    }
    for (let i = 0; i < lanes.length; i++) if (lanes[i] !== null && !touched.has(i)) edges.push({ from: i, to: i, color: colors[i]!, half: 'bottom' })
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }
    const width = edges.reduce((w, e) => Math.max(w, e.from + 1, e.to + 1), lane + 1)
    rows.push({ lane, color, edges, width })
  }
  return { state: { lanes, colors, next }, rows }
}
