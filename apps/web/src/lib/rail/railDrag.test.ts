import { describe, expect, it } from 'vitest'
import { DROP_EDGE, dropTarget, type RailClusterBox, type RailDragSource, type RailDropSpot } from './railDrag'

const clusters: RailClusterBox[] = [
  { key: 'a', top: 0, bottom: 300 },
  { key: 'b', top: 310, bottom: 400 },
]

const spot = (tabKey: string, top: number, h = 40, cluster = 'a'): RailDropSpot => ({ tabKey, cluster, top, bottom: top + h })

const spots: RailDropSpot[] = [
  spot('t1', 40, 32),
  spot('t1', 72),
  spot('t1', 112),
  spot('t2', 152),
  spot('t3', 192),
  spot('t4', 320, 40, 'b'),
]

const pane = (over: Partial<RailDragSource> = {}): RailDragSource => ({ kind: 'pane', paneKey: 'p1', tabKey: 't1', cluster: 'a', title: 'Claude', detachable: true, ...over })

describe('rail drop target', () => {
  it('merges onto a row or group head of another tab in the same project', () => {
    expect(dropTarget(pane(), 172, clusters, spots)).toEqual({ type: 'merge', tabKey: 't2' })
    expect(dropTarget(pane({ kind: 'tab', paneKey: null, detachable: false }), 212, clusters, spots)).toEqual({ type: 'merge', tabKey: 't3' })
  })

  it('does nothing over its own tab', () => {
    expect(dropTarget(pane(), 90, clusters, spots)).toBeNull()
    expect(dropTarget(pane({ kind: 'tab', paneKey: null, detachable: false }), 56, clusters, spots)).toBeNull()
  })

  it('blocks another project and ignores the space outside any project', () => {
    expect(dropTarget(pane(), 340, clusters, spots)).toEqual({ type: 'blocked' })
    expect(dropTarget(pane(), 305, clusters, spots)).toBeNull()
  })

  it('detaches a member dropped in a gap between tabs, on the checkout line or below the last row', () => {
    expect(dropTarget(pane(), 152 + DROP_EDGE - 1, clusters, spots)).toEqual({ type: 'detach', y: 152 })
    expect(dropTarget(pane(), 190, clusters, spots)).toEqual({ type: 'detach', y: 192 })
    expect(dropTarget(pane(), 10, clusters, spots)).toEqual({ type: 'detach', y: 40 })
    expect(dropTarget(pane(), 280, clusters, spots)).toEqual({ type: 'detach', y: 232 })
  })

  it('never detaches a whole tab or a lone pane', () => {
    expect(dropTarget(pane({ detachable: false }), 280, clusters, spots)).toBeNull()
    expect(dropTarget(pane({ detachable: false }), 153, clusters, spots)).toEqual({ type: 'merge', tabKey: 't2' })
    expect(dropTarget(pane({ kind: 'tab', paneKey: null, detachable: false }), 10, clusters, spots)).toBeNull()
  })

  it('skips folded members, which have no height', () => {
    const folded = [spot('t2', 40, 0), spot('t1', 40)]
    expect(dropTarget(pane({ tabKey: 't5', detachable: false }), 40, clusters, folded)).toEqual({ type: 'merge', tabKey: 't1' })
  })
})
