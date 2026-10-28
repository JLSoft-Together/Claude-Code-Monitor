import { describe, expect, it } from 'vitest'
import { stageState, stagedCount } from './changesView'
import type { ChangeEntry } from './preview'

const e = (x: string, y: string, kind: ChangeEntry['kind'] = 'modified'): ChangeEntry => ({ path: 'a', x, y, kind, staged: x !== '.' })

describe('stageState', () => {
  it('reads porcelain XY', () => {
    expect(stageState(e('M', '.'))).toBe('staged')
    expect(stageState(e('M', 'M'))).toBe('partial')
    expect(stageState(e('.', 'M'))).toBe('none')
    expect(stageState(e('?', '?', 'untracked'))).toBe('none')
    expect(stageState(e('U', 'U', 'conflict'))).toBe('none')
    expect(stagedCount([e('A', '.', 'added'), e('.', 'M'), e('M', 'M')])).toBe(2)
  })
})
