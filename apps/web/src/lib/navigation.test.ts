import { describe, expect, it } from 'vitest'
import { cleanSpots, mergeEdit, pushRecent, toggleSpot, trailLeave, trailStep, trailVisit, type Trail } from './navigation'

const spot = (path: string, line: number, text = 'x') => ({ path, line, text, at: 1 })

describe('navigation', () => {
  it('recent files move to the front without duplicates', () => {
    const a = pushRecent([], { path: 'C:\\r\\a.ts', at: 1 })
    const b = pushRecent(a, { path: 'C:\\r\\b.ts', at: 2 })
    expect(pushRecent(b, { path: 'c:/r/a.ts', at: 3 }).map((f) => f.at)).toEqual([3, 2])
    expect(pushRecent(b, { path: 'z', at: 4 }, 2)).toHaveLength(2)
  })

  it('toggles a bookmark on the same line', () => {
    const on = toggleSpot([], spot('/r/a.ts', 4))
    expect(on).toHaveLength(1)
    expect(toggleSpot(on, spot('/r/a.ts', 5))).toHaveLength(2)
    expect(toggleSpot(on, spot('/r/A.ts', 4))).toEqual([])
  })

  it('merges edits on nearby lines of the same file', () => {
    let list = mergeEdit([], spot('/r/a.ts', 10, 'one'))
    list = mergeEdit(list, spot('/r/a.ts', 12, 'two'))
    expect(list).toEqual([spot('/r/a.ts', 12, 'two')])
    list = mergeEdit(list, spot('/r/a.ts', 40))
    list = mergeEdit(list, spot('/r/b.ts', 12))
    expect(list.map((e) => `${e.path}:${e.line}`)).toEqual(['/r/b.ts:12', '/r/a.ts:40', '/r/a.ts:12'])
  })

  it('trail replaces nearby visits, truncates forward on a new one', () => {
    let t: Trail = { spots: [], pos: -1 }
    t = trailVisit(t, { path: '/a', line: 1 })
    t = trailVisit(t, { path: '/a', line: 3 })
    expect(t.spots).toHaveLength(1)
    t = trailVisit(t, { path: '/b', line: 1 })
    t = trailVisit(t, { path: '/c', line: 1 })
    const back = trailStep(trailStep(t, -1)!, -1)!
    expect(back.spots[back.pos]).toEqual({ path: '/a', line: 3 })
    expect(trailStep(back, -1)).toBeNull()
    const fresh = trailVisit(back, { path: '/d', line: 9 })
    expect(fresh.spots.map((s) => s.path)).toEqual(['/a', '/d'])
    expect(trailStep(fresh, 1)).toBeNull()
  })

  it('a late leave from the old pane goes behind the new spot', () => {
    let t: Trail = { spots: [{ path: '/a', line: 1 }], pos: 0 }
    t = trailVisit(t, { path: '/b', line: 7 })
    t = trailLeave(t, { path: '/a', line: 40 }, true)
    expect(t.spots).toEqual([{ path: '/a', line: 1 }, { path: '/a', line: 40 }, { path: '/b', line: 7 }])
    expect(t.pos).toBe(2)
    const again = trailLeave(t, { path: '/a', line: 42 }, true)
    expect(again.spots[1]).toEqual({ path: '/a', line: 42 })
    expect(trailLeave(t, { path: '/c', line: 1 }, false).spots.at(-1)).toEqual({ path: '/c', line: 1 })
  })

  it('cleans stored spots', () => {
    expect(cleanSpots([spot('/a', 2), { path: '/b', line: 0, text: '', at: 1 }, null, 'x'], 10)).toEqual([spot('/a', 2)])
    expect(cleanSpots({}, 10)).toEqual([])
  })
})
