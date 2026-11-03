import { describe, expect, it } from 'vitest'
import { inboxItems } from './inbox'
import type { CheckoutChanges } from './overlap'
import { checkoutOf, whoIsEditing, type EditorPane } from './whoIsEditing'

const common = 'D:\\repo\\.git'
const main: CheckoutChanges = { root: 'D:\\repo', common, branch: 'main', files: ['src/a.ts', 'README.md'] }
const feature: CheckoutChanges = { root: 'D:\\repo\\.worktrees\\feature', common, branch: 'feature', files: ['src/A.ts', 'src/b.ts'] }
const other: CheckoutChanges = { root: 'D:\\elsewhere', common: 'D:\\elsewhere\\.git', branch: 'main', files: ['src/a.ts'] }
const pane = (name: string, dir: string): EditorPane => ({ name, agent: 'claude', status: 'working', dir, lastActivityAt: '2026-11-03T10:00:00.000Z' })

describe('whoIsEditing', () => {
  it('finds the deepest checkout of a folder', () => {
    expect(checkoutOf('D:\\repo\\.worktrees\\feature\\src', [main, feature])?.branch).toBe('feature')
    expect(checkoutOf('D:\\repo\\src', [main, feature])?.branch).toBe('main')
    expect(checkoutOf('E:\\x', [main])).toBeUndefined()
  })

  it('lists other worktrees of the same repo that changed the file, and panes sharing the caller folder', () => {
    const out = whoIsEditing('D:\\repo\\src\\a.ts', 'D:\\repo', [pane('feature', 'D:\\repo\\.worktrees\\feature'), pane('twin', 'D:\\repo\\src'), pane('stranger', 'D:\\elsewhere')], [main, feature, other])
    expect(out.repo).toBe(true)
    expect(out.editors).toEqual([
      { name: 'feature', agent: 'claude', status: 'working', branch: 'feature', root: feature.root, sameCheckout: false, file: 'D:\\repo\\.worktrees\\feature\\src\\a.ts', lastActivityAt: '2026-11-03T10:00:00.000Z' },
      { name: 'twin', agent: 'claude', status: 'working', branch: 'main', root: main.root, sameCheckout: true, file: 'D:\\repo\\src\\a.ts', lastActivityAt: '2026-11-03T10:00:00.000Z' },
    ])
  })

  it('skips worktrees that did not touch the file and says when the caller is not in a repo', () => {
    expect(whoIsEditing('D:\\repo\\README.md', 'D:\\repo', [pane('feature', feature.root)], [main, feature]).editors.map((e) => e.name)).toEqual([])
    expect(whoIsEditing('E:\\plain\\x.ts', 'E:\\plain', [pane('feature', feature.root)], [main, feature])).toEqual({ repo: false, editors: [] })
  })
})

describe('inbox notes', () => {
  const term = { id: 't1', status: 'working', cwd: 'D:\\repo', statusSince: '2026-11-03T09:00:00.000Z' } as never
  const base = { terminals: [term], loops: new Map(), stuck: new Set<string>(), failedRoots: [], doneUnseen: new Set<string>(), dismissed: {} }

  it('a note makes a row with its text; dismissing it hides it until the next note', () => {
    const note = { text: 'Pick a schema', level: 'attention' as const, at: '2026-11-03T10:00:00.000Z', merged: 0 }
    const [row] = inboxItems({ ...base, notes: new Map([['t1', note]]) })
    expect(row).toMatchObject({ id: 't1', reason: 'note', note, stamp: 'note|2026-11-03T10:00:00.000Z' })
    expect(inboxItems({ ...base, notes: new Map([['t1', note]]), dismissed: { t1: row!.stamp } })).toEqual([])
    const next = { ...note, at: '2026-11-03T10:05:00.000Z' }
    expect(inboxItems({ ...base, notes: new Map([['t1', next]]), dismissed: { t1: row!.stamp } })).toHaveLength(1)
  })
})
