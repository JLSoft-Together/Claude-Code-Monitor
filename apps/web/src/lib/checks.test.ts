import { describe, expect, it } from 'vitest'
import { checkOptions, groupErrors } from './checks'

describe('checkOptions', () => {
  it('keeps check-like scripts and adds flutter analyze', () => {
    const scripts = {
      dir: '/r',
      groups: [{ source: 'npm' as const, file: 'package.json', items: [
        { name: 'dev', run: 'npm run dev' },
        { name: 'typecheck', run: 'npm run typecheck' },
        { name: 'test:unit', run: 'npm run test:unit' },
        { name: 'lint', run: 'npm run lint' },
      ] }],
    }
    expect(checkOptions(scripts, true).map((o) => o.label)).toEqual(['npm run typecheck', 'npm run test:unit', 'npm run lint', 'flutter analyze'])
    expect(checkOptions(null, false)).toEqual([])
  })
})

describe('groupErrors', () => {
  it('groups by file, errors first then by line', () => {
    const e = (file: string, line: number, severity: 'error' | 'warning') => ({ file, line, col: 1, message: 'm', severity })
    const g = groupErrors([e('a', 9, 'warning'), e('b', 1, 'error'), e('a', 5, 'error'), e('a', 2, 'error')])
    expect(g.map((x) => [x.file, x.items.map((i) => i.line)])).toEqual([
      ['a', [2, 5, 9]],
      ['b', [1]],
    ])
  })
})
