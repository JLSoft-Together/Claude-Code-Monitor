import { describe, expect, it } from 'vitest'
import { intersect, overlapHits } from './overlap'

describe('overlap', () => {
  it('intersects in the first list order', () => {
    expect(intersect(['b', 'a', 'c'], ['a', 'b'])).toEqual(['b', 'a'])
  })

  it('pairs worktrees of one repo that changed the same files', () => {
    const hits = overlapHits([
      { root: 'F:/r', common: 'F:/r/.git', branch: 'main', files: ['x.ts'] },
      { root: 'F:\\r-wt\\a', common: 'F:/r/.git', branch: 'a', files: ['x.ts', 'y.ts', 'z.ts'] },
      { root: 'F:/r-wt/b', common: 'F:/r/.git', branch: 'b', files: ['y.ts', 'z.ts'] },
      { root: 'F:/other', common: 'F:/other/.git', branch: 'main', files: ['x.ts'] },
      { root: 'F:/r-wt/b/', common: 'F:/r/.git', branch: 'b', files: ['y.ts'] },
    ])
    expect(hits.get('f:\\r-wt\\a')).toEqual([
      { root: 'F:/r-wt/b', branch: 'b', files: ['y.ts', 'z.ts'] },
      { root: 'F:/r', branch: 'main', files: ['x.ts'] },
    ])
    expect(hits.get('f:\\r')).toEqual([{ root: 'F:\\r-wt\\a', branch: 'a', files: ['x.ts'] }])
    expect(hits.has('f:\\other')).toBe(false)
  })
})
