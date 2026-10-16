import { describe, expect, it } from 'vitest'
import { compactEntry, compactState, compactTick, handoffFile, type CompactFlow } from './compactHandoff'

const t = (key: string): string => key
const flow = (over: Partial<CompactFlow> = {}): CompactFlow => ({ step: 'writing', file: 'f.md', base: 0, worked: false, ...over })

describe('compact handoff', () => {
  it('names the handoff file under .planning with a local timestamp', () => {
    const at = new Date(2026, 9, 16, 9, 5)
    expect(handoffFile('C:\\work\\app\\', at)).toBe('C:\\work\\app\\.planning\\HANDOFF-2026-10-16-0905.md')
    expect(handoffFile('/Users/me/app', at)).toBe('/Users/me/app/.planning/HANDOFF-2026-10-16-0905.md')
  })

  it('offers compact only to an idle session', () => {
    expect(compactState('idle', undefined)).toBe('ready')
    expect(compactState('working', undefined)).toBe('busy')
    expect(compactState('waiting', undefined)).toBe('asking')
    expect(compactState(undefined, undefined)).toBe('unlinked')
    expect(compactState('stale', undefined)).toBe('unlinked')
    expect(compactState('idle', flow())).toBe('running')
  })

  it('checks the file once the agent worked and went idle again', () => {
    let f = flow()
    expect(compactTick(f, { status: 'idle', compactions: 0 }).action).toBeNull()
    f = compactTick(f, { status: 'working', compactions: 0 }).flow
    expect(f.worked).toBe(true)
    const done = compactTick(f, { status: 'idle', compactions: 0 })
    expect(done.action).toBe('check')
    expect(done.flow.worked).toBe(false)
  })

  it('resumes when a compaction shows up, in any step', () => {
    expect(compactTick(flow({ step: 'compact', base: 2 }), { status: 'idle', compactions: 3 }).action).toBe('resume')
    expect(compactTick(flow({ base: 1 }), { status: 'working', compactions: 2 }).action).toBe('resume')
    expect(compactTick(flow({ step: 'compact', base: 2 }), { status: 'working', compactions: 2 }).action).toBeNull()
  })

  it('builds the menu entry for each state', () => {
    expect(compactEntry(null, t)).toEqual([])
    expect(compactEntry('ready', t)).toEqual([{ id: 'compact', label: 'workspace.compact.menu', disabled: false, hint: 'workspace.compact.hint' }])
    expect(compactEntry('busy', t)[0]).toMatchObject({ id: 'compact', disabled: true, hint: 'workspace.compact.block.busy' })
    expect(compactEntry('running', t)).toEqual([{ id: 'compact-cancel', label: 'workspace.compact.cancel' }])
  })
})
