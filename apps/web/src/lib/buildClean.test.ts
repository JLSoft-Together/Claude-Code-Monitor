import { describe, expect, it } from 'vitest'
import { busyIn, knownProjects, uniqueDirs } from './buildClean'
import { projectMenu, type ProjectMenuCtx } from './rail/railMenu'

describe('build clean helpers', () => {
  it('dedupes folders by case, slash direction and trailing slash', () => {
    expect(uniqueDirs(['C:\\a\\', 'c:/a', null, 'C:\\a\\b', ''])).toEqual(['C:\\a\\', 'C:\\a\\b'])
  })

  it('lists rail projects (open and remembered) and session roots; openOnly keeps open ones', () => {
    const clusters = [
      { root: 'C:\\p1', live: true, checkouts: [{ path: 'C:\\p1' }, { path: 'C:\\p1-wt' }], history: [] },
      { root: 'C:\\old', live: false, checkouts: [{ path: null }], history: ['C:\\old2'] },
    ]
    expect(knownProjects(clusters, ['C:\\s'])).toEqual(['C:\\p1', 'C:\\p1-wt', 'C:\\old', 'C:\\old2', 'C:\\s'])
    expect(knownProjects(clusters, ['C:\\s'], true)).toEqual(['C:\\p1', 'C:\\p1-wt'])
  })

  it('busyIn matches the project and its subfolders only', () => {
    const busy = [
      { name: 'a', cwd: 'C:\\p\\src' },
      { name: 'b', cwd: 'C:\\p2' },
      { name: 'c', cwd: 'c:/p' },
    ]
    expect(busyIn(busy, 'C:\\p').map((b) => b.name)).toEqual(['a', 'c'])
  })

  it('rail menu offers the clean for a project folder, not for Home', () => {
    const t = (k: string) => k
    const base: ProjectMenuCtx = {
      mac: false,
      dir: 'C:\\p',
      home: false,
      live: true,
      anchored: true,
      viewers: { file: false, changes: false, log: false },
      scripts: false,
      run: false,
      layouts: null,
      explorer: false,
      reveal: false,
      canUp: false,
      canDown: false,
      collapsed: false,
      buildClean: true,
    }
    const ids = (ctx: ProjectMenuCtx) => projectMenu(ctx, t).map((e) => ('id' in e ? e.id : null))
    expect(ids(base)).toContain('build-clean')
    expect(ids({ ...base, home: true, dir: null })).not.toContain('build-clean')
    expect(ids({ ...base, buildClean: false })).not.toContain('build-clean')
  })
})
