import { describe, expect, it } from 'vitest'
import type { BuildError } from '@ccm/shared'
import { checksText, cleanPrompts, diffstatText, expand, missingVars, usedVars } from './promptLibrary'
import type { ChangeEntry } from './preview'

describe('promptLibrary', () => {
  it('expands known vars and keeps missing ones visible', () => {
    const tpl = 'Fix {file} on {branch}; errors:\n{checks}\n{file}'
    expect(usedVars(tpl)).toEqual(['file', 'branch', 'checks'])
    expect(missingVars(tpl, { file: '@a.ts', branch: 'main' })).toEqual(['checks'])
    expect(expand(tpl, { file: '@a.ts', branch: 'main' })).toBe('Fix @a.ts on main; errors:\n{checks}\n@a.ts')
    expect(expand('{unknown} {wt}', { wt: 'F:/x' })).toBe('{unknown} F:/x')
  })

  it('drops bad, duplicate and oversized saved prompts', () => {
    const big = 'x'.repeat(9000)
    const list = cleanPrompts([
      { id: 'a', name: ' Review ', text: 'Look at {file}', scope: 'global' },
      { id: 'a', name: 'dup', text: 't', scope: 'global' },
      { id: 'b', name: 'big', text: big, scope: 'global' },
      { id: 'c', name: '', text: 't', scope: 'global' },
      { id: 'd', name: 'n', text: 't' },
      null,
    ])
    expect(list).toEqual([{ id: 'a', name: 'Review', text: 'Look at {file}', scope: 'global' }])
    expect(cleanPrompts('nope')).toEqual([])
  })

  it('formats checks relative to the root, errors first, capped', () => {
    const errs = [
      { file: 'F:\\r\\src\\b.ts', line: 3, message: 'unused', severity: 'warning' },
      { file: 'F:/r/src/a.ts', line: 1, message: 'bad', severity: 'error' },
    ] as BuildError[]
    expect(checksText(errs, 'F:\\r')).toBe('src/a.ts:1: bad\nsrc/b.ts:3: unused')
    expect(checksText(errs, undefined, 1)).toBe('F:/r/src/a.ts:1: bad\n… +1')
  })

  it('summarises a diffstat', () => {
    const e = [
      { path: 'a.ts', added: 2, removed: 1 },
      { path: 'b.ts', added: 1 },
    ] as ChangeEntry[]
    expect(diffstatText(e)).toBe('2 files, +3 -1\na.ts (+2 -1)\nb.ts (+1 -0)')
    expect(diffstatText([])).toBe('')
  })
})
