import { describe, expect, it } from 'vitest'
import type { RailCluster } from './rail/railModel'
import { dropMru, filterProjects, landingTab, MRU_LIMIT, projectEntries, readMru, touchMru } from './projectSwitcher'

const cluster = (root: string | null, over: Partial<RailCluster> = {}): RailCluster => ({
  key: `plain:${root}`,
  aliases: [],
  name: root?.split('\\').pop() ?? 'Home',
  root,
  live: false,
  active: false,
  needs: 0,
  failed: 0,
  checkouts: [],
  tabKeys: [],
  history: [],
  ...over,
})

describe('projectEntries', () => {
  it('merges rail, history and favourites by folder, most recent first', () => {
    const list = projectEntries({
      clusters: [cluster(null, { tabKeys: ['h'] }), cluster('F:\\a', { tabKeys: ['t1', 't2'], active: true, needs: 1, checkouts: [{ key: 'k', path: 'F:\a', branch: 'main', tag: null, primary: true, active: true, rows: [], groups: [] }] }), cluster('F:\\b', { history: ['F:\\b\\sub'] })],
      mru: [
        { dir: 'f:\\b\\sub', at: 30 },
        { dir: 'F:\\old', at: 10 },
        { dir: 'F:\\a\\', at: 20 },
      ],
      favorites: [{ dir: 'F:\\fav', label: 'Fav' }, { dir: 'F:\\a' }],
    })
    expect(list.map((e) => e.dir)).toEqual(['F:\\b', 'F:\\a', 'F:\\old', 'F:\\fav'])
    const a = list.find((e) => e.dir === 'F:\\a')!
    expect(a).toMatchObject({ tabs: 2, active: true, needs: 1, favorite: true, usedAt: 20, branch: 'main' })
    expect(list.find((e) => e.dir === 'F:\\fav')).toMatchObject({ name: 'Fav', tabs: 0, favorite: true })
  })
})

describe('filterProjects', () => {
  const entries = projectEntries({ clusters: [cluster('F:\\work\\orrery'), cluster('F:\\games\\cat-loop')], mru: [], favorites: [] })

  it('keeps order for an empty query', () => {
    expect(filterProjects(entries, ' ').map((h) => h.entry.name)).toEqual(['orrery', 'cat-loop'])
  })

  it('ranks name matches, falls back to the path', () => {
    const hits = filterProjects(entries, 'cl')
    expect(hits[0]!.entry.name).toBe('cat-loop')
    expect(hits[0]!.name.length).toBe(2)
    const byPath = filterProjects(entries, 'games')
    expect(byPath.map((h) => h.entry.name)).toEqual(['cat-loop'])
    expect(byPath[0]!.dir.length).toBe(5)
    expect(filterProjects(entries, 'zzz')).toEqual([])
  })
})

describe('mru', () => {
  it('moves a folder to the front once and caps the list', () => {
    let list = touchMru([], 'F:\\a', 1)
    list = touchMru(list, 'F:\\b', 2)
    list = touchMru(list, 'f:\\a\\', 3)
    expect(list).toEqual([
      { dir: 'f:\\a\\', at: 3 },
      { dir: 'F:\\b', at: 2 },
    ])
    expect(dropMru(list, 'F:\\B')).toEqual([{ dir: 'f:\\a\\', at: 3 }])
    for (let i = 0; i < MRU_LIMIT + 5; i++) list = touchMru(list, `F:\\p${i}`, i)
    expect(list.length).toBe(MRU_LIMIT)
  })

  it('reads only valid rows', () => {
    expect(readMru('[{"dir":"F:\\\\a","at":1},{"dir":2},null]')).toEqual([{ dir: 'F:\\a', at: 1 }])
    expect(readMru('nope')).toEqual([])
    expect(readMru(null)).toEqual([])
  })
})

describe('landingTab', () => {
  it('picks the tab focused last', () => {
    const at: Record<string, number> = { a: 5, b: 9, c: 0 }
    expect(landingTab(['a', 'b', 'c'], (k) => at[k]!)).toBe('b')
    expect(landingTab(['x'], () => 0)).toBe('x')
    expect(landingTab([], () => 0)).toBeUndefined()
  })
})
