import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { problemsFor } from '../lib/problems'
import { useChecksStore } from './checks'

describe('checks store, terminal source', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('adds a scan as a problem run, replaces it per pane and drops it when empty', () => {
    const checks = useChecksStore()
    const err = { file: '/proj/src/a.ts', line: 3, col: 1, message: 'TS1: x', severity: 'error' as const }
    checks.setTerminal('p1', 'terminal proj', [err])
    expect(problemsFor(checks.problemRuns, '/proj/src/a.ts')).toMatchObject({ errors: 1, label: 'terminal proj' })
    checks.setTerminal('p1', 'terminal proj', [{ ...err, line: 9 }])
    expect(problemsFor(checks.problemRuns, '/proj/src/a.ts')?.items.map((e) => e.line)).toEqual([9])
    expect(checks.marked.get('/proj/src/a.ts')).toBe('error')
    checks.setTerminal('p1', 'terminal proj', [])
    expect(checks.problemRuns).toEqual([])
  })
})
