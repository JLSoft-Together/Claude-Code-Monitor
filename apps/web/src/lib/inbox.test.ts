import { describe, expect, it } from 'vitest'
import type { TerminalSession } from '@ccm/shared'
import { inboxItems, pruneDismissed, type InboxInput } from './inbox'

const term = (id: string, over: Partial<TerminalSession> = {}): TerminalSession => ({ id, title: id, status: 'idle', ...over }) as TerminalSession

const base = (over: Partial<InboxInput> = {}): InboxInput => ({
  terminals: [],
  loops: new Map(),
  stuck: new Set(),
  failedRoots: [],
  doneUnseen: new Set(),
  dismissed: {},
  ...over,
})

describe('inbox', () => {
  it('keeps the most urgent reason per agent and sorts by urgency, then age', () => {
    const items = inboxItems(
      base({
        terminals: [
          term('done', { statusSince: '2026-10-29T01:00:00Z' }),
          term('wait2', { status: 'waiting', statusSince: '2026-10-29T01:05:00Z' }),
          term('wait1', { status: 'waiting', statusSince: '2026-10-29T01:00:00Z' }),
          term('check', { cwd: 'F:\\r\\app', status: 'working' }),
          term('loop', { status: 'working' }),
          term('gone', { status: 'stale' }),
        ],
        loops: new Map([['loop', { since: '2026-10-29T01:00:00Z' }], ['wait2', { since: '2026-10-29T00:00:00Z' }]]),
        failedRoots: ['F:/r'],
        doneUnseen: new Set(['done', 'gone']),
      }),
    )
    expect(items.map((i) => `${i.id}:${i.reason}`)).toEqual(['wait1:waiting', 'wait2:waiting', 'loop:loop', 'check:checks', 'done:done'])
  })

  it('hides a dismissed row until its state changes', () => {
    const waiting = term('a', { status: 'waiting', statusSince: '2026-10-29T01:00:00Z' })
    const [item] = inboxItems(base({ terminals: [waiting] }))
    expect(inboxItems(base({ terminals: [waiting], dismissed: { a: item!.stamp } }))).toEqual([])
    const again = { ...waiting, statusSince: '2026-10-29T01:09:00Z' }
    expect(inboxItems(base({ terminals: [again], dismissed: { a: item!.stamp } }))).toHaveLength(1)
    expect(pruneDismissed({ a: 'x', b: 'y' }, new Set(['a']))).toEqual({ a: 'x' })
  })
})
