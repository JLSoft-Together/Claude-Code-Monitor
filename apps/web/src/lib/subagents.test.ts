import { describe, expect, it } from 'vitest'
import { effectiveStatus, runningSubagents } from './subagents'

describe('subagents', () => {
  it('counts only live subagents', () => {
    expect(
      runningSubagents([
        { role: 'main', status: 'idle' },
        { role: 'subagent', status: 'working' },
        { role: 'subagent', status: 'waiting' },
        { role: 'subagent', status: 'completed' },
        { role: 'subagent', status: 'cancelled' },
        { role: 'subagent', status: 'idle' },
      ]),
    ).toBe(2)
    expect(runningSubagents(undefined)).toBe(0)
  })

  it('an idle main agent with live subagents is still working', () => {
    expect(effectiveStatus('idle', 2)).toBe('working')
    expect(effectiveStatus('idle', 0)).toBe('idle')
    expect(effectiveStatus('waiting', 3)).toBe('waiting')
    expect(effectiveStatus('error', 1)).toBe('error')
  })
})
