import type { Agent } from '@ccm/shared'

export interface Point {
  x: number
  y: number
}

export const MAIN_WIDTH = 300
export const MAIN_HEIGHT = 96
export const PILL_WIDTH = 240
export const PILL_HEIGHT = 30
export const TRAY_WIDTH = 232
export const TRAY_HEIGHT = 28
export const TRUNK_X = 20
export const BUS_LEAD = 12
export const CHILD_INDENT = 40
const SIBLING_GAP = 12
const LEVEL_GAP = 26
const ROW_GAP = 22
const TRAY_GAP = 18
const COLUMN_GAP = 64
const SESSION_ROW_GAP = 72
export const PER_ROW_CHOICES = [1, 2, 3] as const

export interface NodeSize {
  w?: number
  h?: number
}

export interface LayoutInput {
  terminals: string[]
  agentsByTerminal: Record<string, Agent[]>
  perRow: number
  rowWidth?: number
  trays?: Record<string, boolean>
  sizes?: Record<string, NodeSize>
}

export interface LayoutResult {
  positions: Map<string, Point>
  width: number
  height: number
}

export function trayId(terminalId: string): string {
  return `tray:${terminalId}`
}

export function trayTerminal(id: string): string | null {
  return id.startsWith('tray:') ? id.slice(5) : null
}

export function treeOrder(agents: Agent[]): { agent: Agent; depth: number }[] {
  const main = agents.find((a) => a.role === 'main')
  const ids = new Set(agents.map((a) => a.id))
  const children = new Map<string, Agent[]>()
  const rootId = main?.id ?? ''
  for (const a of agents) {
    if (a === main) continue
    const parent = a.parentId && a.parentId !== a.id && ids.has(a.parentId) ? a.parentId : rootId
    const list = children.get(parent) ?? []
    list.push(a)
    children.set(parent, list)
  }
  const out: { agent: Agent; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (id: string, depth: number) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push({ agent: child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(rootId, 1)
  for (const a of agents) if (a !== main && !seen.has(a.id)) out.push({ agent: a, depth: 1 })
  return out
}

interface TreeBox {
  id: string
  w: number
  h: number
  kids: TreeBox[]
  sw: number
  sh: number
}

function buildTree(agents: Agent[], sizes: Record<string, NodeSize>): TreeBox {
  const main = agents.find((a) => a.role === 'main')
  const root: TreeBox = main
    ? { id: main.id, w: sizes[main.id]?.w ?? MAIN_WIDTH, h: Math.max(MAIN_HEIGHT, sizes[main.id]?.h ?? 0), kids: [], sw: 0, sh: 0 }
    : { id: '', w: 0, h: -LEVEL_GAP, kids: [], sw: 0, sh: 0 }
  const stack: TreeBox[] = [root]
  for (const { agent, depth } of treeOrder(agents)) {
    const box: TreeBox = { id: agent.id, w: PILL_WIDTH, h: PILL_HEIGHT, kids: [], sw: 0, sh: 0 }
    const parent = stack[Math.min(depth - 1, stack.length - 1)]!
    parent.kids.push(box)
    stack.length = Math.min(depth, stack.length)
    stack[depth] = box
  }
  return root
}

function rowsOf(kids: TreeBox[], perRow: number): TreeBox[][] {
  const rows: TreeBox[][] = []
  for (let i = 0; i < kids.length; i += perRow) rows.push(kids.slice(i, i + perRow))
  return rows
}

function measure(box: TreeBox, perRow: number): void {
  for (const k of box.kids) measure(k, perRow)
  if (!box.kids.length) {
    box.sw = box.w
    box.sh = Math.max(0, box.h)
    return
  }
  let blockW = 0
  let blockH = 0
  const rows = rowsOf(box.kids, perRow)
  rows.forEach((row, i) => {
    blockW = Math.max(blockW, row.reduce((s, k) => s + k.sw, 0) + SIBLING_GAP * (row.length - 1))
    blockH += Math.max(...row.map((k) => k.sh)) + (i ? ROW_GAP : 0)
  })
  const indent = box.id ? CHILD_INDENT : 0
  box.sw = Math.max(box.w, indent + blockW)
  box.sh = box.h + LEVEL_GAP + blockH
}

function place(box: TreeBox, x: number, y: number, perRow: number, out: Map<string, Point>): void {
  if (box.id) out.set(box.id, { x, y })
  let top = y + box.h + LEVEL_GAP
  const indent = box.id ? CHILD_INDENT : 0
  for (const row of rowsOf(box.kids, perRow)) {
    let left = x + indent
    for (const k of row) {
      place(k, left, top, perRow, out)
      left += k.sw + SIBLING_GAP
    }
    top += Math.max(...row.map((k) => k.sh)) + ROW_GAP
  }
}

export function computeLayout(input: LayoutInput): LayoutResult {
  const perRow = Math.max(1, Math.floor(input.perRow))
  const rowWidth = input.rowWidth ?? Infinity
  const sizes = input.sizes ?? {}
  const positions = new Map<string, Point>()
  let x0 = 0
  let y0 = 0
  let rowH = 0
  let width = 0
  for (const terminalId of input.terminals) {
    const agents = input.agentsByTerminal[terminalId]
    if (!agents?.length) continue
    const tree = buildTree(agents, sizes)
    measure(tree, perRow)
    const tray = input.trays?.[terminalId] ?? false
    const trayIndent = tree.id ? CHILD_INDENT : 0
    const w = Math.max(tree.sw, tray ? trayIndent + TRAY_WIDTH : 0)
    const h = tree.sh + (tray ? TRAY_GAP + TRAY_HEIGHT : 0)
    if (x0 > 0 && x0 + w > rowWidth) {
      x0 = 0
      y0 += rowH + SESSION_ROW_GAP
      rowH = 0
    }
    place(tree, x0, y0, perRow, positions)
    if (tray) positions.set(trayId(terminalId), { x: x0 + trayIndent, y: y0 + tree.sh + TRAY_GAP })
    width = Math.max(width, x0 + w)
    rowH = Math.max(rowH, h)
    x0 += w + COLUMN_GAP
  }
  return { positions, width, height: positions.size ? y0 + rowH : 0 }
}

export interface Viewport {
  width: number
  height: number
}

const FIT_PAD = 48
const STICKY = 1.15

export function fitZoom(result: LayoutResult, view: Viewport, max = 1.1): number {
  if (!result.width || !result.height) return max
  return Math.min(max, (view.width - FIT_PAD) / result.width, (view.height - FIT_PAD) / result.height)
}

export function pickLayout(input: Omit<LayoutInput, 'perRow' | 'rowWidth'>, view: Viewport, prev?: number): { perRow: number; result: LayoutResult } {
  const rowWidth = Math.max(MAIN_WIDTH, view.width - FIT_PAD)
  const tried = PER_ROW_CHOICES.map((perRow) => {
    const result = computeLayout({ ...input, perRow, rowWidth })
    return { perRow, result, zoom: fitZoom(result, view) }
  })
  let best = tried[0]!
  for (const c of tried) if (c.zoom > best.zoom + 0.001) best = c
  const kept = tried.find((c) => c.perRow === prev)
  if (kept && kept !== best && kept.zoom * STICKY >= best.zoom) best = kept
  return { perRow: best.perRow, result: best.result }
}

export function isFinished(a: Agent): boolean {
  return a.role !== 'main' && (a.status === 'completed' || a.status === 'cancelled')
}

export function visibleAgents(agents: Agent[], hideFinished: boolean): { visible: Set<string>; hidden: number } {
  const visible = new Set<string>()
  if (!hideFinished) {
    for (const a of agents) visible.add(a.id)
    return { visible, hidden: 0 }
  }
  const byId = new Map(agents.map((a) => [a.id, a]))
  for (const a of agents) {
    if (isFinished(a)) continue
    let cur: Agent | undefined = a
    while (cur && !visible.has(cur.id)) {
      visible.add(cur.id)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }
  return { visible, hidden: agents.length - visible.size }
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type PeerSide = 'left' | 'right'

export interface PeerArc {
  d: string
  from: Point
  to: Point
  mid: Point
  sameRow: boolean
}

export interface PeerEnds {
  id: string
  a: string
  b: string
}

export const PEER_ARC_MIN = 20
export const PEER_ARC_MAX = 44
export const PEER_SLOT_GAP = 6
export const PEER_LANE = 20
export const PEER_ENTRY_Y = 22
const PEER_CORNER = 8

const centerX = (box: Box) => box.x + box.w / 2
const tidy = (n: number) => Math.round(n * 10) / 10
const near = (a: number, b: number) => Math.abs(a - b) < 0.01

export function peerArcHeight(dx: number): number {
  return Math.min(PEER_ARC_MAX, Math.max(PEER_ARC_MIN, Math.abs(dx) * 0.12))
}

export function peerSameRow(a: Box, b: Box): boolean {
  return Math.abs(a.y - b.y) < Math.min(a.h, b.h)
}

export function peerSides(a: Box, b: Box): { a: PeerSide; b: PeerSide } {
  return centerX(a) <= centerX(b) ? { a: 'right', b: 'left' } : { a: 'left', b: 'right' }
}

function anchorX(box: Box, side: PeerSide): number {
  return box.x + (side === 'right' ? (2 * box.w) / 3 : box.w / 3)
}

export function roundedPath(points: readonly Point[], radius: number): string {
  const unique: Point[] = []
  for (const p of points) {
    const last = unique.at(-1)
    if (!last || !near(last.x, p.x) || !near(last.y, p.y)) unique.push(p)
  }
  const pts: Point[] = []
  for (let i = 0; i < unique.length; i++) {
    const prev = pts.at(-1)
    const p = unique[i]!
    const next = unique[i + 1]
    if (prev && next && ((near(prev.x, p.x) && near(p.x, next.x)) || (near(prev.y, p.y) && near(p.y, next.y)))) continue
    pts.push(p)
  }
  const first = pts[0]
  if (!first) return ''
  const out = [`M ${tidy(first.x)} ${tidy(first.y)}`]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!
    const c = pts[i]!
    const b = pts[i + 1]!
    const lin = Math.hypot(c.x - a.x, c.y - a.y)
    const lout = Math.hypot(b.x - c.x, b.y - c.y)
    const r = Math.min(radius, lin / 2, lout / 2)
    const p1 = { x: c.x + ((a.x - c.x) / lin) * r, y: c.y + ((a.y - c.y) / lin) * r }
    const p2 = { x: c.x + ((b.x - c.x) / lout) * r, y: c.y + ((b.y - c.y) / lout) * r }
    out.push(`L ${tidy(p1.x)} ${tidy(p1.y)}`, `Q ${tidy(c.x)} ${tidy(c.y)} ${tidy(p2.x)} ${tidy(p2.y)}`)
  }
  const last = pts.at(-1)!
  if (pts.length > 1) out.push(`L ${tidy(last.x)} ${tidy(last.y)}`)
  return out.join(' ')
}

function lanePath(a: Box, b: Box, sa: number, sb: number): PeerArc {
  const lower = a.y >= b.y ? a : b
  const corridor = lower.y - SESSION_ROW_GAP / 2 + sa + sb
  const entryA = a.y + PEER_ENTRY_Y
  const entryB = b.y + PEER_ENTRY_Y
  const from = { x: a.x, y: entryA + sa * (corridor > entryA ? 1 : -1) }
  const to = { x: b.x, y: entryB + sb * (corridor > entryB ? 1 : -1) }
  const laneA = a.x - PEER_LANE + sa
  const laneB = b.x - PEER_LANE + sb
  const d = roundedPath(
    [from, { x: laneA, y: from.y }, { x: laneA, y: corridor }, { x: laneB, y: corridor }, { x: laneB, y: to.y }, to],
    PEER_CORNER,
  )
  return { d, from, to, mid: { x: (laneA + laneB) / 2, y: corridor }, sameRow: false }
}

export function peerPath(a: Box, b: Box, slot: { a?: number; b?: number } = {}): PeerArc {
  if (!peerSameRow(a, b)) return lanePath(a, b, slot.a ?? 0, slot.b ?? 0)
  const side = peerSides(a, b)
  const from = { x: anchorX(a, side.a) + (slot.a ?? 0), y: a.y }
  const to = { x: anchorX(b, side.b) + (slot.b ?? 0), y: b.y }
  const top = Math.min(a.y, b.y) - peerArcHeight(to.x - from.x)
  const c = (8 * top - a.y - b.y) / 6
  const mid = { x: (from.x + to.x) / 2, y: (from.y + 6 * c + to.y) / 8 }
  const d = `M ${tidy(from.x)} ${tidy(from.y)} C ${tidy(from.x)} ${tidy(c)} ${tidy(to.x)} ${tidy(c)} ${tidy(to.x)} ${tidy(to.y)}`
  return { d, from, to, mid, sameRow: true }
}

export function peerSlots(links: readonly PeerEnds[], boxes: ReadonlyMap<string, Box>, gap = PEER_SLOT_GAP): Map<string, { a: number; b: number }> {
  type Entry = { link: string; end: 'a' | 'b'; sign: number; dist: number }
  const groups = new Map<string, Entry[]>()
  const add = (key: string, entry: Entry) => {
    const list = groups.get(key)
    if (list) list.push(entry)
    else groups.set(key, [entry])
  }
  const out = new Map<string, { a: number; b: number }>()
  for (const l of links) {
    const a = boxes.get(l.a)
    const b = boxes.get(l.b)
    if (!a || !b) continue
    out.set(l.id, { a: 0, b: 0 })
    if (peerSameRow(a, b)) {
      const side = peerSides(a, b)
      const dist = Math.abs(centerX(b) - centerX(a))
      add(`${l.a}\u0000${side.a}`, { link: l.id, end: 'a', sign: side.a === 'right' ? 1 : -1, dist })
      add(`${l.b}\u0000${side.b}`, { link: l.id, end: 'b', sign: side.b === 'right' ? 1 : -1, dist })
    } else {
      const dist = Math.abs(centerX(b) - centerX(a)) + Math.abs(b.y - a.y)
      add(`${l.a}\u0000lane`, { link: l.id, end: 'a', sign: 1, dist })
      add(`${l.b}\u0000lane`, { link: l.id, end: 'b', sign: 1, dist })
    }
  }
  for (const list of groups.values()) {
    list.sort((x, y) => y.dist - x.dist || x.link.localeCompare(y.link))
    const n = list.length
    list.forEach((e, i) => {
      out.get(e.link)![e.end] = (i - (n - 1) / 2) * gap * e.sign || 0
    })
  }
  return out
}

export function treePath(sx: number, sy: number, tx: number, ty: number, radius = 6): string {
  const bus = ty - BUS_LEAD
  const dx = tx - sx
  if (Math.abs(dx) < 1 || bus <= sy) return `M ${sx} ${sy} L ${sx} ${ty}`
  const dir = Math.sign(dx)
  const r = Math.max(0, Math.min(radius, Math.abs(dx) / 2, (bus - sy) / 2, BUS_LEAD / 2))
  return [
    `M ${sx} ${sy}`,
    `L ${sx} ${bus - r}`,
    `Q ${sx} ${bus} ${sx + dir * r} ${bus}`,
    `L ${tx - dir * r} ${bus}`,
    `Q ${tx} ${bus} ${tx} ${bus + r}`,
    `L ${tx} ${ty}`,
  ].join(' ')
}
