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
