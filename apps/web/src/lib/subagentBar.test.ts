import { describe, expect, it } from 'vitest'
import { tallySubagents } from './subagentBar'

describe('tallySubagents', () => {
  it('counts nothing for no agents and ignores the main agent', () => {
    expect(tallySubagents([])).toEqual({ total: 0, done: 0, running: 0, error: 0, other: 0 })
    expect(tallySubagents([{ role: 'main', status: 'working' }]).total).toBe(0)
  })

  it('splits done / running / error and keeps the rest as other', () => {
    const sub = (status: 'completed' | 'working' | 'waiting' | 'error' | 'cancelled' | 'idle') => ({ role: 'subagent' as const, status })
    const t = tallySubagents([sub('completed'), sub('completed'), sub('working'), sub('waiting'), sub('error'), sub('cancelled'), sub('idle')])
    expect(t).toEqual({ total: 7, done: 2, running: 2, error: 1, other: 2 })
  })
})
