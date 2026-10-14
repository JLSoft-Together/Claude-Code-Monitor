import { describe, expect, it } from 'vitest'
import { clampLane, emptyGraph, extendGraph, flatRows, graphWidth, MAX_LANES, type CommitLink } from './commitGraph'

const c = (hash: string, ...parents: string[]): CommitLink => ({ hash, parents })
const layout = (commits: CommitLink[]) => extendGraph(emptyGraph(), commits).rows

describe('extendGraph', () => {
  it('keeps a linear history on lane 0', () => {
    const rows = layout([c('A', 'B'), c('B', 'C'), c('C')])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows[0]!.edges).toEqual([{ from: 0, to: 0, color: 0, half: 'bottom' }])
    expect(rows[1]!.edges).toEqual([
      { from: 0, to: 0, color: 0, half: 'top' },
      { from: 0, to: 0, color: 0, half: 'bottom' },
    ])
    expect(rows[2]!.edges).toEqual([{ from: 0, to: 0, color: 0, half: 'top' }])
  })

  it('opens a lane for the second parent of a merge and joins it back', () => {
    const rows = layout([c('M', 'A', 'B'), c('A', 'C'), c('B', 'C'), c('C')])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0])
    expect(rows[0]!.edges).toEqual([
      { from: 0, to: 0, color: 0, half: 'bottom' },
      { from: 0, to: 1, color: 1, half: 'bottom' },
    ])
    expect(rows[2]!.color).toBe(1)
    expect(rows[3]!.edges).toEqual([
      { from: 0, to: 0, color: 0, half: 'top' },
      { from: 1, to: 0, color: 1, half: 'top' },
    ])
    expect(graphWidth(rows)).toBe(2)
  })

  it('starts a new lane for a second branch tip', () => {
    const rows = layout([c('X', 'C'), c('Y', 'C'), c('C')])
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0])
    expect(rows[1]!.edges).toContainEqual({ from: 0, to: 0, color: 0, half: 'top' })
    expect(rows[1]!.edges).toContainEqual({ from: 1, to: 1, color: 1, half: 'bottom' })
  })

  it('fans out an octopus merge', () => {
    const rows = layout([c('O', 'A', 'B', 'C')])
    expect(rows[0]!.edges).toEqual([
      { from: 0, to: 0, color: 0, half: 'bottom' },
      { from: 0, to: 1, color: 1, half: 'bottom' },
      { from: 0, to: 2, color: 2, half: 'bottom' },
    ])
  })

  it('reuses a free slot in the middle', () => {
    const rows = layout([c('O', 'A', 'B', 'C'), c('B'), c('Z', 'Q')])
    expect(rows[2]!.lane).toBe(1)
  })

  it('gives the same rows when fed page by page', () => {
    const all = [c('M', 'A', 'B'), c('A', 'D'), c('X', 'B'), c('B', 'D'), c('D', 'E'), c('E')]
    const once = extendGraph(emptyGraph(), all)
    for (let cut = 1; cut < all.length; cut++) {
      const a = extendGraph(emptyGraph(), all.slice(0, cut))
      const b = extendGraph(a.state, all.slice(cut))
      expect([...a.rows, ...b.rows]).toEqual(once.rows)
      expect(b.state).toEqual(once.state)
    }
  })

  it('clamps lanes past the cap and builds flat rows', () => {
    expect(clampLane(3)).toBe(3)
    expect(clampLane(MAX_LANES + 5)).toBe(MAX_LANES - 1)
    expect(flatRows(2)).toEqual([
      { lane: 0, color: 0, edges: [], width: 1 },
      { lane: 0, color: 0, edges: [], width: 1 },
    ])
  })
})
