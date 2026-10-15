import type { DiffFile } from './diff'

/** A point in a windowed view's model: row index + column in that row's text (`col > length` = after its line break). */
export interface TextPos {
  row: number
  col: number
}

export interface DomPoint {
  node: Node
  offset: number
}

export const comparePos = (a: TextPos, b: TextPos): number => a.row - b.row || a.col - b.col

/** Text between two points, rows joined by `\n`; rows whose text is null (folds, gaps, fillers) are skipped. */
export function sliceRows(rowText: (i: number) => string | null, a: TextPos, b: TextPos): string {
  const [s, e] = comparePos(a, b) <= 0 ? [a, b] : [b, a]
  const parts: string[] = []
  let trailingBreak = false
  for (let i = s.row; i <= e.row; i++) {
    const t = rowText(i)
    if (t === null) continue
    if (i === s.row && s.col > t.length && s.row !== e.row) continue
    const from = i === s.row ? Math.min(s.col, t.length) : 0
    const to = i === e.row ? Math.min(e.col, t.length) : t.length
    parts.push(t.slice(from, Math.max(from, to)))
    if (i === e.row) trailingBreak = e.col > t.length && s.col <= t.length
  }
  return parts.join('\n') + (trailingBreak ? '\n' : '')
}

/** One side of a diff as text (folded and hidden context included): `old` = context + deleted, `new` = context + added. */
export function diffSideText(file: DiffFile, side: 'old' | 'new'): string {
  const skip = side === 'old' ? 'add' : 'del'
  const out: string[] = []
  for (const h of file.hunks) for (const l of h.lines) if (l.type !== skip && l.type !== 'note') out.push(l.text)
  return out.join('\n')
}

const rowIndex = (el: Element): number | null => {
  const v = (el as HTMLElement).dataset?.i
  return v === undefined ? null : Number(v)
}

function textLength(el: Element): number {
  return el.querySelector('.c')?.textContent?.length ?? 0
}

/**
 * Model point of a DOM point inside `container`, whose children are rows (`[data-i]`, text in `.c`) plus spacers /
 * marks. Points on a spacer map to the nearest rendered row edge; null when nothing is rendered.
 */
export function pointToPos(container: Element, node: Node, offset: number): TextPos | null {
  if (!container.contains(node)) return null
  const el = node instanceof Element ? node : node.parentElement
  const row = el?.closest('[data-i]')
  if (row && container.contains(row) && row !== container) {
    const i = rowIndex(row)!
    const c = row.querySelector('.c')
    if (!c) return { row: i, col: 0 }
    if (c === node || c.contains(node)) {
      const r = (container.ownerDocument ?? document).createRange()
      r.setStart(c, 0)
      r.setEnd(node, offset)
      return { row: i, col: r.toString().length }
    }
    const before = node === row ? offset <= Array.prototype.indexOf.call(row.childNodes, c) : !!(node.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)
    return { row: i, col: before ? 0 : textLength(row) }
  }
  let child: Node | null
  if (node === container) child = container.childNodes[offset] ?? null
  else {
    let top: Node = node
    while (top.parentNode && top.parentNode !== container) top = top.parentNode
    child = top
  }
  for (let n = child; n; n = n.nextSibling) {
    if (n instanceof Element && rowIndex(n) !== null) return { row: rowIndex(n)!, col: 0 }
  }
  for (let n = child ? child.previousSibling : container.lastChild; n; n = n.previousSibling) {
    if (n instanceof Element && rowIndex(n) !== null) return { row: rowIndex(n)!, col: textLength(n) }
  }
  return null
}

/** DOM point for a model point; `clamped` when its row is outside the rendered window (edge of the rendered rows). */
export function posToPoint(container: Element, pos: TextPos): (DomPoint & { clamped: boolean }) | null {
  const rows = container.querySelectorAll(':scope > [data-i]')
  if (!rows.length) return null
  const first = rows[0]!
  const last = rows[rows.length - 1]!
  const indexOf = (n: Node): number => Array.prototype.indexOf.call(container.childNodes, n)
  if (pos.row < rowIndex(first)!) return { node: container, offset: indexOf(first), clamped: true }
  if (pos.row > rowIndex(last)!) return { node: container, offset: indexOf(last) + 1, clamped: true }
  const row = container.querySelector(`:scope > [data-i="${pos.row}"]`)
  const c = row?.querySelector('.c')
  if (!row || !c) return row ? { node: row, offset: 0, clamped: false } : null
  let left = pos.col
  const walker = (container.ownerDocument ?? document).createTreeWalker(c, NodeFilter.SHOW_TEXT)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const len = t.textContent?.length ?? 0
    if (left <= len) return { node: t, offset: left, clamped: false }
    left -= len
  }
  return { node: c, offset: c.childNodes.length, clamped: false }
}

/** First / last model row in the DOM, or null. */
export function renderedRows(container: Element): [number, number] | null {
  const rows = container.querySelectorAll(':scope > [data-i]')
  if (!rows.length) return null
  return [rowIndex(rows[0]!)!, rowIndex(rows[rows.length - 1]!)!]
}
