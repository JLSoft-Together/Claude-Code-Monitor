import { describe, expect, it } from 'vitest'
import { parseConflicts, resolveConflict } from './mergeConflicts'

const file = ['top', '<<<<<<< HEAD', 'mine', '=======', 'yours', '>>>>>>> feat', 'mid', '<<<<<<< ours', 'a', '||||||| base', 'o', '=======', 'b', '>>>>>>> theirs', 'end'].join('\r\n')

describe('conflicts', () => {
  it('parses merge and diff3 blocks with labels', () => {
    const r = parseConflicts(file)
    expect(r.count).toBe(2)
    expect(r.eol).toBe('\r\n')
    const blocks = r.segments.filter((s) => s.kind === 'conflict').map((s) => (s.kind === 'conflict' ? s.block : null))
    expect(blocks[0]).toMatchObject({ line: 2, oursLabel: 'HEAD', theirsLabel: 'feat', ours: ['mine'], theirs: ['yours'], base: null })
    expect(blocks[1]).toMatchObject({ ours: ['a'], base: ['o'], theirs: ['b'] })
  })

  it('resolves one block and keeps the other markers and line endings', () => {
    const once = resolveConflict(file, 0, 'theirs')
    expect(once.split('\r\n').slice(0, 3)).toEqual(['top', 'yours', 'mid'])
    expect(parseConflicts(once).count).toBe(1)
    const both = resolveConflict(once, 0, 'both')
    expect(both).toBe(['top', 'yours', 'mid', 'a', 'b', 'end'].join('\r\n'))
  })

  it('ignores stray markers that do not close', () => {
    expect(parseConflicts('a\n<<<<<<< x\nb\n').count).toBe(0)
    expect(parseConflicts('=======\n').count).toBe(0)
  })
})
