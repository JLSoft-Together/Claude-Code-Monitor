import { describe, expect, it } from 'vitest'
import type { BuildError } from '@ccm/shared'
import { pathKey } from './changesView'
import { problemFiles, problemsFor, stepProblem } from './problems'

const err = (file: string, line: number, severity: 'error' | 'warning' = 'error'): BuildError => ({ file, line, col: 1, message: `m${line}`, severity })

describe('problems', () => {
  const runs = [
    { label: 'tsc', at: 200, errors: [err('C:\\Repo\\a.ts', 9), err('C:/repo/b.ts', 1, 'warning')] },
    { label: 'lint', at: 100, errors: [err('c:/repo/a.ts', 3, 'warning'), err('c:/repo/b.ts', 2)] },
  ]

  it('matches Windows paths case-insensitively and merges runs', () => {
    expect(pathKey('C:\\Repo\\a.ts')).toBe('c:/repo/a.ts')
    expect(pathKey('/Home/x.ts')).toBe('/Home/x.ts')
    const p = problemsFor(runs, 'C:/REPO/a.ts')!
    expect(p.items.map((e) => e.line)).toEqual([3, 9])
    expect([p.errors, p.warnings, p.label, p.at]).toEqual([1, 1, 'tsc, lint', 100])
    expect(problemsFor(runs, 'c:/repo/none.ts')).toBeNull()
  })

  it('keeps the worst severity per file', () => {
    const m = problemFiles(runs)
    expect(m.get('c:/repo/a.ts')).toBe('error')
    expect(m.get('c:/repo/b.ts')).toBe('error')
  })

  it('steps forward and back with wrap-around', () => {
    const items = [err('a', 3), err('a', 9)]
    expect(stepProblem(items, 1, 1)).toBe(0)
    expect(stepProblem(items, 3, 1)).toBe(1)
    expect(stepProblem(items, 9, 1)).toBe(0)
    expect(stepProblem(items, 3, -1)).toBe(1)
    expect(stepProblem(items, 9, -1)).toBe(0)
    expect(stepProblem([], 1, 1)).toBe(-1)
  })
})
