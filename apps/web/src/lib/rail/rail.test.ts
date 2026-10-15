import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore, type Pane } from '../../stores/workspace'
import { lastRows, registerSnapshot, snapshotOf } from '../paneSnapshots'
import { buildAttentionList } from './attentionList'
import { avatarInitials } from './avatars'
import { flipTransform, missionShelf } from './mission'
import { projectTabKeys, spaceIndexes, spaceLabel } from './spaces'
import { buildRail, paneState, rowLines, runState, type RailInput, type RailSession } from './railModel'
import { applyOrder, MAX_RAIL_ORDER, pinAt } from './railOrder'
import { mainCheckout, repoFacts } from './repo'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  setActivePinia(createPinia())
})

const FACTS: Record<string, ReturnType<typeof repoFacts>> = {
  'C:\\work\\app': repoFacts('C:\\work\\app', true, 'C:\\work\\app\\.git'),
  'C:\\work\\app-wt\\feat': repoFacts('C:\\work\\app-wt\\feat', true, 'C:\\work\\app\\.git'),
  'D:\\notes': repoFacts('D:\\notes', false),
}

function input(over: Partial<RailInput> = {}): RailInput {
  const ws = useWorkspaceStore()
  return {
    tabs: ws.tabs,
    panes: ws.panes,
    activeKey: ws.activeKey,
    sessionOf: () => undefined,
    factsOf: (d) => FACTS[d],
    labelOf: (p) => p.command ?? (p.kind === 'run' ? 'Run' : 'Shell'),
    agentLabel: (p) => ({ claude: 'Claude', codex: 'Codex', shell: 'Shell' })[p],
    history: [],
    order: [],
    ...over,
  }
}

describe('repo facts', () => {
  it('folds a worktree under the repo of its common dir', () => {
    expect(mainCheckout('C:\\work\\app\\.git')).toBe('C:\\work\\app')
    expect(mainCheckout('/srv/app.git')).toBeNull()
    const main = repoFacts('C:\\work\\app', true, 'C:\\work\\app\\.git')
    const wt = repoFacts('C:\\work\\app-wt\\feat', true, 'C:\\work\\app\\.git')
    expect(wt.key).toBe(main.key)
    expect(wt.main).toBe('C:\\work\\app')
  })

  it('keys a non-repo folder as plain and a repo without common dir by its toplevel', () => {
    expect(repoFacts('D:\\notes', false).key).toBe('plain:d:\\notes')
    expect(repoFacts('D:\\lib', true)).toEqual({ key: 'repo:d:\\lib', top: 'D:\\lib', main: 'D:\\lib', repo: true })
  })
})

describe('rail state', () => {
  const pane = (over: Partial<Pane>): Pane => ({ key: 'p', preset: 'claude', state: 'running', ...over })
  const s = (status: RailSession['status']): RailSession => ({ status, title: 'x' })

  it('reads latched attention and failures before live phase', () => {
    expect(paneState(pane({ state: 'error' }), s('working'))).toBe('failed')
    expect(paneState(pane({ attention: 'waiting' }), s('working'))).toBe('asked')
    expect(paneState(pane({}), s('waiting'))).toBe('asked')
    expect(paneState(pane({ state: 'exited' }), undefined)).toBe('ended')
    expect(paneState(pane({}), s('working'))).toBe('working')
    expect(paneState(pane({ attention: 'done' }), s('idle'))).toBe('done')
    expect(paneState(pane({ state: 'starting' }), undefined)).toBe('starting')
    expect(paneState(pane({}), undefined)).toBe('idle')
  })

  it('maps run badges: building / running work, a failed run needs you', () => {
    expect(runState('busy')).toBe('working')
    expect(runState('running')).toBe('working')
    expect(runState('failed')).toBe('failed')
    expect(runState(null)).toBe('idle')
  })
})

describe('buildRail', () => {
  it('folds worktrees into one repo cluster with a checkout line each', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('claude', 'C:\\work\\app-wt\\feat')
    ws.open('shell', 'D:\\notes')
    const rail = buildRail(input())
    expect(rail.map((c) => c.name)).toEqual(['app', 'notes'])
    expect(rail[0]!.checkouts.map((c) => [c.path, c.tag, c.primary])).toEqual([
      ['C:\\work\\app', null, true],
      ['C:\\work\\app-wt\\feat', 'worktree', false],
    ])
    expect(rail[1]!.checkouts[0]!.tag).toBe('folder')
  })

  it('gives two silent Claude panes of one checkout distinct ordinals', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.split(a.key, 'row')
    ws.open('claude', 'C:\\work\\app')
    const rows = buildRail(input())[0]!.checkouts[0]!.rows
    expect(rows.map((r) => [r.task, r.ordinal])).toEqual([
      [null, 'Claude'],
      [null, 'Claude 2'],
      [null, 'Claude 3'],
    ])
  })

  it('puts the ordinal behind a shared session name, never on the name', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('claude', 'C:\\work\\app')
    const rows = buildRail(input({ sessionOf: () => ({ status: 'idle', title: 'Fix login' }) }))[0]!.checkouts[0]!.rows
    expect(rows.map((r) => [r.task, r.ordinal])).toEqual([
      ['Fix login', 'Claude'],
      ['Fix login', 'Claude 2'],
    ])
  })

  it('shows a tab without agents as one row and a home tab under the home cluster', () => {
    const ws = useWorkspaceStore()
    ws.runScript('D:\\notes', 'npm test')
    ws.open('shell')
    const rail = buildRail(input())
    expect(rail.map((c) => [c.key, c.root])).toEqual([
      ['plain:d:\\notes', 'D:\\notes'],
      ['home', null],
    ])
    expect(rail[0]!.checkouts[0]!.rows[0]!).toMatchObject({ kind: 'other', agent: 'npm test' })
  })

  it('gives a run pane its own row whose failed run counts as needing you', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.update(a.key, { state: 'running' })
    const r = ws.split(a.key, 'row', { kind: 'run' })!
    const rail = buildRail(input({ runOf: (p) => (p.key === r.key ? 'failed' : null) }))
    const rows = rail[0]!.checkouts[0]!.rows
    expect(rows.map((x) => [x.kind, x.state, x.run])).toEqual([
      ['agent', 'idle', null],
      ['other', 'failed', 'failed'],
    ])
    expect(rail[0]!.needs).toBe(1)
    expect(rail[0]!.failed).toBe(1)
  })

  it('counts who needs you and marks exactly one focused row', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    const b = ws.open('claude', 'C:\\work\\app')
    ws.update(a.key, { attention: 'waiting', state: 'running' })
    const rail = buildRail(input())
    expect(rail[0]!.needs).toBe(1)
    expect(rail.flatMap((c) => c.checkouts.flatMap((k) => k.rows)).filter((r) => r.focused).map((r) => r.paneKey)).toEqual([b.key])
  })

  it('keeps remembered projects as rowless clusters after the live ones', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    const rail = buildRail(input({ history: ['C:\\work\\app-wt\\feat', 'D:\\notes'] }))
    expect(rail.map((c) => [c.name, c.live])).toEqual([
      ['app', true],
      ['notes', false],
    ])
    expect(rail[0]!.history).toEqual(['C:\\work\\app-wt\\feat'])
  })

  it('groups a tab whose git lookup is pending under a provisional plain key', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'E:\\fresh')
    expect(buildRail(input())[0]!.key).toBe('plain:e:\\fresh')
  })

  it('keeps the tab project when a pane cds elsewhere', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.update(a.key, { cwd: 'D:\\notes', liveCwd: 'D:\\notes' })
    expect(buildRail(input())[0]!.name).toBe('app')
  })
})

describe('rail order', () => {
  const c = (key: string, aliases: string[] = []) => ({ key, aliases })

  it('puts pinned clusters first, matching provisional plain keys too', () => {
    const list = [c('repo:a'), c('repo:b', ['plain:b']), c('plain:c')]
    expect(applyOrder(list, ['plain:b']).map((x) => x.key)).toEqual(['repo:b', 'repo:a', 'plain:c'])
    expect(applyOrder(list, [])).toEqual(list)
  })

  it('pins every cluster above the drop slot', () => {
    expect(pinAt([c('a'), c('b'), c('c')], 2, 0, [])).toEqual(['c'])
    expect(pinAt([c('a'), c('b'), c('c')], 0, 2, ['x'])).toEqual(['b', 'c', 'a', 'x'])
    expect(pinAt([c('a'), c('b')], 1, 1, [])).toBeNull()
    expect(pinAt([c('a'), c('a')], 0, 1, [])).toBeNull()
  })

  it('caps the stored order, dropping keys no longer on screen first', () => {
    const old = Array.from({ length: MAX_RAIL_ORDER }, (_, i) => `gone${i}`)
    const next = pinAt([c('a'), c('b')], 1, 0, old)!
    expect(next).toHaveLength(MAX_RAIL_ORDER)
    expect(next[0]).toBe('b')
  })
})

describe('row lines', () => {
  const base = { kind: 'agent' as const, agent: 'Claude' }

  it('silent unnamed rows carry the ordinal on line 1, named rows on line 2', () => {
    expect(rowLines({ ...base, task: null, ordinal: 'Claude 2' }, 'Ready')).toEqual({ first: 'Claude 2', second: 'Claude · Ready' })
    expect(rowLines({ ...base, task: 'Fix login', ordinal: 'Claude 2' }, 'Working')).toEqual({ first: 'Fix login', second: 'Claude 2 · Working' })
    expect(rowLines({ ...base, kind: 'other', agent: 'npm test', task: null, ordinal: 'npm test' }, 'Running')).toEqual({ first: 'npm test', second: 'Running' })
  })
})

describe('avatars', () => {
  it('takes two letters of the last word of a project name', () => {
    expect(avatarInitials('spacevibe-deck')).toBe('De')
    expect(avatarInitials('Claude-Code-Monitor')).toBe('Mo')
    expect(avatarInitials('app2')).toBe('Ap')
    expect(avatarInitials('---')).toBe('?')
  })
})

describe('spaces', () => {
  it('scopes the strip to the active tab project', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.open('shell', 'D:\\notes')
    const c = ws.open('claude', 'C:\\work\\app-wt\\feat')
    const keyOf = (k: string) => ws.tabOf(k)!.key
    expect(projectTabKeys(buildRail(input()), ws.tabs, keyOf(c.key))).toEqual([keyOf(a.key), keyOf(c.key)])
  })

  it('keeps tab open order on the strip, not the rail checkout grouping', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    const b = ws.open('claude', 'C:\\work\\app-wt\\feat')
    const c = ws.open('claude', 'C:\\work\\app')
    const keyOf = (k: string) => ws.tabOf(k)!.key
    expect(projectTabKeys(buildRail(input()), ws.tabs, keyOf(a.key))).toEqual([keyOf(a.key), keyOf(b.key), keyOf(c.key)])
  })

  it('falls back to every tab when the active tab is unknown', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('shell', 'D:\\notes')
    expect(projectTabKeys(buildRail(input()), ws.tabs, null)).toHaveLength(2)
  })

  it('numbers tabs sharing one folder and leaves single tabs bare', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('claude', 'c:/work/app/')
    ws.open('shell', 'D:\\notes')
    const idx = spaceIndexes(ws.tabs, (t) => t.project)
    expect(ws.tabs.map((t) => idx.get(t.key))).toEqual([1, 2, null])
    expect(spaceLabel('app', 2)).toBe('app 2')
    expect(spaceLabel('app', null)).toBe('app')
  })
})

describe('pane snapshots', () => {
  it('keeps the last n rows after trimming trailing blank lines', () => {
    expect(lastRows(['a', 'b', 'c', '', '  '], 2)).toBe('b\nc')
    expect(lastRows(['', ''], 14)).toBe('')
  })

  it('reads through the registry and forgets on unregister', () => {
    const off = registerSnapshot('p1', (n) => Array.from({ length: n + 2 }, (_, i) => `l${i}`))
    expect(snapshotOf('p1', 2)).toBe('l2\nl3')
    off()
    expect(snapshotOf('p1', 2)).toBe('')
  })
})

describe('mission control', () => {
  const paneOf = (k: string) => useWorkspaceStore().panes.find((p) => p.key === k)
  it('shelves every project with its spaces and windows, unscoped', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.split(a.key, 'row')
    ws.open('claude', 'C:\\work\\app')
    ws.open('shell', 'D:\\notes')
    const shelf = missionShelf(buildRail(input()), ws.tabs, ws.activeTab!.key, () => 'app', (k) => k, paneOf)
    expect(shelf.map((g) => [g.name, g.spaces.length])).toEqual([
      ['app', 2],
      ['notes', 1],
    ])
    expect(shelf[0]!.spaces[0]!.windows).toHaveLength(2)
    expect(shelf[0]!.spaces.map((s) => s.label)).toEqual(['app 1', 'app 2'])
    expect(shelf[1]!.spaces[0]!.current).toBe(true)
  })

  it('carries a run pane state into its window', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    const r = ws.split(a.key, 'row', { kind: 'run' })!
    const shelf = missionShelf(buildRail(input({ runOf: () => 'busy' })), ws.tabs, ws.activeTab!.key, () => 'app', (k) => k, paneOf)
    expect(shelf[0]!.spaces[0]!.windows.find((w) => w.paneKey === r.key)).toMatchObject({ state: 'working', run: 'busy' })
  })

  it('numbers spaces by the primary pane folder for tabs saved before v38', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('claude', 'C:\\work\\app')
    for (const tab of ws.tabs) tab.project = undefined
    const shelf = missionShelf(buildRail(input()), ws.tabs, ws.activeTab!.key, () => 'app', (k) => k, paneOf)
    expect(shelf[0]!.spaces.map((s) => s.label)).toEqual(['app 1', 'app 2'])
  })

  it('maps a window rect onto a pane rect with translate + scale', () => {
    expect(flipTransform({ left: 0, top: 0, width: 100, height: 50 }, { left: 10, top: 20, width: 200, height: 100 })).toBe('translate(10px, 20px) scale(2, 2)')
  })
})

describe('needs-you list', () => {
  it('lists failed before asked, oldest first, with a footer of the rest', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    const b = ws.open('claude', 'C:\\work\\app')
    const c = ws.open('claude', 'D:\\notes')
    ws.update(a.key, { attention: 'waiting', state: 'running' })
    ws.update(b.key, { state: 'error' })
    ws.update(c.key, { state: 'running' })
    const sessions: Record<string, RailSession> = { [a.key]: { status: 'waiting', title: 'A', since: '2026-10-15T10:00:00Z' }, [c.key]: { status: 'working', title: 'C' } }
    const list = buildAttentionList(buildRail(input({ sessionOf: (p) => sessions[p.key] })))
    expect(list.entries.map((e) => [e.paneKey, e.state])).toEqual([
      [b.key, 'failed'],
      [a.key, 'asked'],
    ])
    expect(list.footer.working).toBe(1)
  })

  it('lists a failed run', () => {
    const ws = useWorkspaceStore()
    const r = ws.openRun('C:\\work\\app')
    const list = buildAttentionList(buildRail(input({ runOf: () => 'failed' })))
    expect(list.entries).toMatchObject([{ paneKey: r.key, state: 'failed', run: 'failed' }])
  })
})
