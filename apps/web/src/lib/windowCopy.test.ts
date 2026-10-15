import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diff'
import { diffSideText, pointToPos, posToPoint, renderedRows, sliceRows } from './windowCopy'

const lines = ['alpha', 'beta', 'gamma', 'delta']
const text = (i: number): string | null => lines[i] ?? null

describe('sliceRows', () => {
  it('cuts the first and last row at their columns', () => {
    expect(sliceRows(text, { row: 0, col: 2 }, { row: 2, col: 3 })).toBe('pha\nbeta\ngam')
  })
  it('accepts a backwards selection', () => {
    expect(sliceRows(text, { row: 2, col: 3 }, { row: 0, col: 2 })).toBe('pha\nbeta\ngam')
  })
  it('keeps the line break when the end is past the row text', () => {
    expect(sliceRows(text, { row: 1, col: 0 }, { row: 1, col: 5 })).toBe('beta\n')
    expect(sliceRows(text, { row: 1, col: 0 }, { row: 2, col: 0 })).toBe('beta\n')
  })
  it('starts on the next row when the start is past its text', () => {
    expect(sliceRows(text, { row: 0, col: 6 }, { row: 1, col: 2 })).toBe('be')
  })
  it('skips rows without text', () => {
    const t = (i: number): string | null => (i === 1 ? null : text(i))
    expect(sliceRows(t, { row: 0, col: 0 }, { row: 2, col: 5 })).toBe('alpha\ngamma')
  })
  it('same row, same column = empty', () => {
    expect(sliceRows(text, { row: 3, col: 2 }, { row: 3, col: 2 })).toBe('')
  })
})

describe('diffSideText', () => {
  const file = parseUnifiedDiff(
    ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', ' keep', '-old', '+new', ' tail', '\\ No newline at end of file'].join('\n'),
  )[0]!
  it('old = context + deleted, new = context + added, notes left out', () => {
    expect(diffSideText(file, 'old')).toBe('keep\nold\ntail')
    expect(diffSideText(file, 'new')).toBe('keep\nnew\ntail')
  })
})

/** Rows 10..12 rendered between two spacers, like a windowed view. */
function windowDom(): HTMLElement {
  const c = document.createElement('div')
  c.innerHTML =
    '<div class="ccm-spacer"></div>' +
    [10, 11, 12].map((i) => `<div class="r" data-i="${i}"><span class="n">${i + 1}</span><span class="c"><span>ab</span>c${i}\n</span></div>`).join('') +
    '<div class="ccm-spacer"></div>'
  document.body.appendChild(c)
  return c
}

describe('DOM ↔ model points', () => {
  it('maps a text point to row + column', () => {
    const c = windowDom()
    const row = c.querySelector('[data-i="11"] .c')!
    const tail = row.childNodes[1]!
    expect(pointToPos(c, tail, 2)).toEqual({ row: 11, col: 4 })
    expect(pointToPos(c, row.firstChild!.firstChild!, 1)).toEqual({ row: 11, col: 1 })
  })
  it('gutter = column 0, container points snap to the nearest rendered row', () => {
    const c = windowDom()
    expect(pointToPos(c, c.querySelector('[data-i="12"] .n')!.firstChild!, 1)).toEqual({ row: 12, col: 0 })
    expect(pointToPos(c, c, 0)).toEqual({ row: 10, col: 0 })
    expect(pointToPos(c, c, c.childNodes.length)).toEqual({ row: 12, col: 'abc12\n'.length })
  })
  it('round-trips rendered points and clamps rows outside the window', () => {
    const c = windowDom()
    const p = posToPoint(c, { row: 11, col: 3 })!
    expect(p.clamped).toBe(false)
    expect(pointToPos(c, p.node, p.offset)).toEqual({ row: 11, col: 3 })
    const above = posToPoint(c, { row: 2, col: 0 })!
    expect(above).toMatchObject({ node: c, offset: 1, clamped: true })
    const below = posToPoint(c, { row: 900, col: 4 })!
    expect(below).toMatchObject({ node: c, offset: 4, clamped: true })
    expect(renderedRows(c)).toEqual([10, 12])
  })
})
