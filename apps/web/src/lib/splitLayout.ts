/** Split tree of one workspace tab; leaves are pane keys. Every operation returns a new tree. */
export type SplitDir = 'row' | 'col'
export type LayoutNode = { pane: string } | { dir: SplitDir; ratio: number; a: LayoutNode; b: LayoutNode }
export type FocusDir = 'left' | 'right' | 'up' | 'down'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Divider {
  /** Child choices from the root, e.g. "ab" = root.a.b. */
  path: string
  dir: SplitDir
  ratio: number
  box: Box
}

export const MIN_RATIO = 0.15
export const MAX_RATIO = 0.85
const UNIT: Box = { x: 0, y: 0, w: 1, h: 1 }

export const isLeaf = (n: LayoutNode): n is { pane: string } => 'pane' in n
export const clampRatio = (r: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, Number.isFinite(r) ? r : 0.5))

export function leaves(n: LayoutNode): string[] {
  return isLeaf(n) ? [n.pane] : [...leaves(n.a), ...leaves(n.b)]
}

export function splitLeaf(n: LayoutNode, target: string, added: string, dir: SplitDir): LayoutNode {
  if (isLeaf(n)) return n.pane === target ? { dir, ratio: 0.5, a: n, b: { pane: added } } : n
  return { ...n, a: splitLeaf(n.a, target, added, dir), b: splitLeaf(n.b, target, added, dir) }
}

/** The tree without that leaf (its sibling takes the parent's place); null when it was the last one. */
export function removeLeaf(n: LayoutNode, target: string): LayoutNode | null {
  if (isLeaf(n)) return n.pane === target ? null : n
  const a = removeLeaf(n.a, target)
  const b = removeLeaf(n.b, target)
  if (!a) return b
  if (!b) return a
  return a === n.a && b === n.b ? n : { ...n, a, b }
}

export type Edge = 'left' | 'right' | 'top' | 'bottom'

// 24 columns of 13px mono plus the well padding: narrower panes stop being usable for an agent TUI.
export const MIN_PANE = { w: 220, h: 140 } as const

/**
 * Where a new pane joins the tab: the roomiest pane (`prefer` wins a tie), split along its longer side, the other
 * side when that one would be too small. Two, three, four panes grow into halves, a half split again, then a 2 × 2 grid.
 * Null when every pane is already too small to halve. An unmeasured canvas (0 × 0) splits side by side.
 */
export function dockSpot(n: LayoutNode, prefer: string | undefined, size: { w: number; h: number }, min = MIN_PANE): { key: string; dir: SplitDir } | null {
  const all = boxes(n)
  const area = (k: string): number => all.get(k)!.w * all.get(k)!.h
  const order = [...all.keys()].sort((a, b) => {
    const d = area(b) - area(a)
    return Math.abs(d) > 1e-6 ? d : a === prefer ? -1 : b === prefer ? 1 : 0
  })
  for (const key of order) {
    if (!size.w || !size.h) return { key, dir: 'row' }
    const box = all.get(key)!
    const w = box.w * size.w
    const h = box.h * size.h
    const want: SplitDir = w >= h * 1.4 ? 'row' : 'col'
    const fits = (d: SplitDir): boolean => (d === 'row' ? w / 2 >= min.w : h / 2 >= min.h)
    if (fits(want)) return { key, dir: want }
    const other: SplitDir = want === 'row' ? 'col' : 'row'
    if (fits(other)) return { key, dir: other }
  }
  return null
}

/** Leaf `target` becomes a split holding `sub` on that edge and itself on the other; `n` itself when target is missing. */
export function dockTree(n: LayoutNode, target: string, sub: LayoutNode, edge: Edge): LayoutNode {
  if (isLeaf(n)) {
    if (n.pane !== target) return n
    const first = edge === 'left' || edge === 'top'
    return { dir: edge === 'left' || edge === 'right' ? 'row' : 'col', ratio: 0.5, a: first ? sub : n, b: first ? n : sub }
  }
  const a = dockTree(n.a, target, sub, edge)
  const b = dockTree(n.b, target, sub, edge)
  return a === n.a && b === n.b ? n : { ...n, a, b }
}

/** Leaf `src` leaves its slot and docks onto `edge` of leaf `target`; `n` itself when that is not a move. */
export function movePane(n: LayoutNode, src: string, target: string, edge: Edge): LayoutNode {
  const keys = leaves(n)
  if (src === target || !keys.includes(src) || !keys.includes(target)) return n
  const rest = removeLeaf(n, src)
  return rest ? dockTree(rest, target, { pane: src }, edge) : n
}

/** The two leaves trade places; every split keeps its direction and ratio. */
export function swapPanes(n: LayoutNode, a: string, b: string): LayoutNode {
  const keys = leaves(n)
  if (a === b || !keys.includes(a) || !keys.includes(b)) return n
  const swap = (m: LayoutNode): LayoutNode => (isLeaf(m) ? (m.pane === a ? { pane: b } : m.pane === b ? { pane: a } : m) : { ...m, a: swap(m.a), b: swap(m.b) })
  return swap(n)
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Edge of the rect nearest to the point, distances taken as fractions of width / height (diagonal split). */
export function edgeAt(r: Rect, x: number, y: number): Edge {
  const w = Math.max(1, r.right - r.left)
  const h = Math.max(1, r.bottom - r.top)
  const d: Array<[Edge, number]> = [
    ['left', (x - r.left) / w],
    ['right', (r.right - x) / w],
    ['top', (y - r.top) / h],
    ['bottom', (r.bottom - y) / h],
  ]
  return d.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]
}

/** Pane under the point and the edge to dock on; null over a gap or over `exclude`. */
export function dropTargetAt(rects: ReadonlyMap<string, Rect>, x: number, y: number, exclude: string | null): { key: string; edge: Edge } | null {
  for (const [key, r] of rects) {
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
    return key === exclude ? null : { key, edge: edgeAt(r, x, y) }
  }
  return null
}

export function setRatio(n: LayoutNode, path: string, ratio: number): LayoutNode {
  if (isLeaf(n)) return n
  if (!path) return { ...n, ratio: clampRatio(ratio) }
  const side = path[0] === 'a' ? 'a' : 'b'
  return { ...n, [side]: setRatio(n[side], path.slice(1), ratio) }
}

function childBoxes(n: Exclude<LayoutNode, { pane: string }>, box: Box): [Box, Box] {
  if (n.dir === 'row') {
    const w = box.w * n.ratio
    return [
      { ...box, w },
      { ...box, x: box.x + w, w: box.w - w },
    ]
  }
  const h = box.h * n.ratio
  return [
    { ...box, h },
    { ...box, y: box.y + h, h: box.h - h },
  ]
}

/** Each pane's rectangle as fractions of the tab's area. */
export function boxes(n: LayoutNode, box: Box = UNIT, out = new Map<string, Box>()): Map<string, Box> {
  if (isLeaf(n)) return out.set(n.pane, box)
  const [a, b] = childBoxes(n, box)
  boxes(n.a, a, out)
  boxes(n.b, b, out)
  return out
}

export function dividers(n: LayoutNode, box: Box = UNIT, path = ''): Divider[] {
  if (isLeaf(n)) return []
  const [a, b] = childBoxes(n, box)
  return [{ path, dir: n.dir, ratio: n.ratio, box }, ...dividers(n.a, a, `${path}a`), ...dividers(n.b, b, `${path}b`)]
}

const EPS = 1e-6

/** Nearest pane on that side that overlaps the current one across the other axis. */
export function neighbor(n: LayoutNode, from: string, dir: FocusDir): string | null {
  const all = boxes(n)
  const src = all.get(from)
  if (!src) return null
  let best: string | null = null
  let bestDist = Infinity
  for (const [key, b] of all) {
    if (key === from) continue
    const horizontal = dir === 'left' || dir === 'right'
    const overlaps = horizontal ? b.y < src.y + src.h - EPS && b.y + b.h > src.y + EPS : b.x < src.x + src.w - EPS && b.x + b.w > src.x + EPS
    if (!overlaps) continue
    const dist =
      dir === 'right' ? b.x - (src.x + src.w) : dir === 'left' ? src.x - (b.x + b.w) : dir === 'down' ? b.y - (src.y + src.h) : src.y - (b.y + b.h)
    if (dist < -EPS) continue
    // Ties (several panes touching that edge) go to the one sharing most of the current pane's span.
    const center = horizontal ? Math.abs(b.y + b.h / 2 - (src.y + src.h / 2)) : Math.abs(b.x + b.w / 2 - (src.x + src.w / 2))
    const score = dist + center * 1e-3
    if (score < bestDist) {
      bestDist = score
      best = key
    }
  }
  return best
}

export function isLayout(v: unknown, depth = 0): v is LayoutNode {
  if (!v || typeof v !== 'object' || depth > 16) return false
  const n = v as Record<string, unknown>
  if (typeof n.pane === 'string') return true
  return (n.dir === 'row' || n.dir === 'col') && typeof n.ratio === 'number' && isLayout(n.a, depth + 1) && isLayout(n.b, depth + 1)
}
