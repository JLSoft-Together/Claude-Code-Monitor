import { describe, expect, it } from 'vitest'
import type { RailCheckout, RailCluster, RailRow, RailState } from './railModel'
import { buildSections, filterCluster, hasAgentWork, railMoveIndexes } from './railView'

const row = (key: string, state: RailState, task: string | null = null, group: string | null = null): RailRow =>
  ({ key, paneKey: key, tabKey: `t-${key}`, kind: 'agent', agent: 'Claude', task, ordinal: 'Claude', state, group }) as unknown as RailRow

const checkout = (key: string, rows: RailRow[], branch: string | null = null, groups: RailCheckout['groups'] = []): RailCheckout =>
  ({ key, path: `/w/${key}`, branch, tag: null, primary: true, active: false, rows, groups }) as RailCheckout

const cluster = (name: string, checkouts: RailCheckout[], live = true): RailCluster =>
  ({ key: `repo:${name}`, aliases: [], name, root: `/w/${name}`, live, active: false, needs: 0, failed: 0, checkouts, tabKeys: [], history: [] }) as RailCluster

const label = (c: RailCluster): string => c.name

describe('rail sections', () => {
  const busy = cluster('busy', [checkout('a', [row('r1', 'working', 'Fix login')])])
  const asking = cluster('asking', [checkout('b', [row('r2', 'asked')])])
  const calm = cluster('calm', [checkout('c', [row('r3', 'idle'), row('r4', 'done')])])
  const closed = cluster('closed', [checkout('d', [])], false)

  it('counts running, starting and waiting panes as agent work, not idle or done', () => {
    expect([busy, asking, calm, closed].map(hasAgentWork)).toEqual([true, true, false, false])
    expect(hasAgentWork(cluster('boot', [checkout('e', [row('r5', 'starting')])]))).toBe(true)
    expect(hasAgentWork(cluster('sub', [checkout('f', [row('r6', 'subagents')])]))).toBe(true)
    expect(hasAgentWork(cluster('dead', [checkout('g', [row('r7', 'working')])], false))).toBe(false)
  })

  it('splits agents / opened / others and keeps the rail order inside each', () => {
    const s = buildSections([calm, busy, closed, asking], '', label)
    expect(s.agents.map((c) => c.name)).toEqual(['busy', 'asking'])
    expect(s.opened.map((c) => c.name)).toEqual(['calm'])
    expect(s.others.map((c) => c.name)).toEqual(['closed'])
  })

  it('handles no projects and all-closed', () => {
    expect(buildSections([], '', label)).toEqual({ agents: [], opened: [], others: [] })
    const s = buildSections([closed, cluster('old', [checkout('h', [])], false)], '', label)
    expect([s.agents.length, s.opened.length, s.others.length]).toEqual([0, 0, 2])
  })

  it('a filter that matches nothing empties every section', () => {
    expect(buildSections([busy, calm, closed], 'zzz', label)).toEqual({ agents: [], opened: [], others: [] })
  })
})

describe('rail filter', () => {
  const grouped = checkout('g', [row('x1', 'working', 'Alpha task', 'group:t1'), row('x2', 'idle', 'Beta task', 'group:t1'), row('x3', 'idle', 'Gamma')], 'feature/x', [
    { key: 'group:t1', title: 'Pair' } as RailCheckout['groups'][number],
  ])
  const c = cluster('orrery', [grouped, checkout('wt', [row('y1', 'idle', 'Other')], 'hotfix')])

  it('an empty query is the identity', () => {
    expect(filterCluster(c, '  ', 'orrery')).toBe(c)
  })

  it('keeps the whole project when its name or folder matches (case-insensitive)', () => {
    expect(filterCluster(c, 'ORR', 'orrery')).toBe(c)
    expect(filterCluster(c, '/w/orr', 'Home')).toBe(c)
  })

  it('keeps only matching rows, dropping groups with no match', () => {
    const hit = filterCluster(c, 'gamma', 'orrery')!
    expect(hit.checkouts).toHaveLength(1)
    expect(hit.checkouts[0]!.rows.map((r) => r.key)).toEqual(['x3'])
    expect(hit.checkouts[0]!.groups).toEqual([])
  })

  it('a group title keeps all its rows; a branch keeps the checkout', () => {
    const byGroup = filterCluster(c, 'pair', 'orrery')!
    expect(byGroup.checkouts[0]!.rows.map((r) => r.key)).toEqual(['x1', 'x2'])
    expect(byGroup.checkouts[0]!.groups).toHaveLength(1)
    const byBranch = filterCluster(c, 'hotfix', 'orrery')!
    expect(byBranch.checkouts.map((k) => k.key)).toEqual(['wt'])
  })

  it('returns null when nothing matches and never mutates the source', () => {
    expect(filterCluster(c, 'nope', 'orrery')).toBeNull()
    filterCluster(c, 'gamma', 'orrery')
    expect(c.checkouts[0]!.rows).toHaveLength(3)
  })

  it('does not move a project between sections', () => {
    const s = buildSections([c], 'gamma', label)
    expect(s.agents).toHaveLength(1)
    expect(s.agents[0]!.checkouts[0]!.rows.map((r) => r.state)).toEqual(['idle'])
  })
})

describe('rail drag mapping', () => {
  const all = ['a', 'b', 'c', 'd', 'e']

  it('maps rendered indexes (sections reorder the list) back to the full rail order', () => {
    const shown = ['c', 'a', 'd']
    expect(railMoveIndexes(shown, all, 0, 2)).toEqual([2, 3])
    expect(railMoveIndexes(shown, all, 2, 0)).toEqual([3, 2])
  })

  it('ignores a drop on itself or outside the rendered list', () => {
    expect(railMoveIndexes(all, all, 1, 1)).toBeNull()
    expect(railMoveIndexes(['a'], all, 0, 3)).toBeNull()
    expect(railMoveIndexes(['x'], all, 0, 0)).toBeNull()
  })
})
