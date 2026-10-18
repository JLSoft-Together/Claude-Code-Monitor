import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore, type Pane } from '../../stores/workspace'
import { lastRows, registerSnapshot, snapshotOf } from '../paneSnapshots'
import { buildAttentionList } from './attentionList'
import { avatarInitials } from './avatars'
import { flipTransform } from './mission'
import { projectTabKeys, spaceIndexes, spaceLabel } from './spaces'
import {
  buildRail,
  groupState,
  headId,
  isPeerNews,
  latestPeer,
  paneState,
  peerSlot,
  railItems,
  rowId,
  rowLines,
  runState,
  showsCheckouts,
  stateWord,
  tabStopOf,
  treeIds,
  type RailInput,
  type RailPeer,
  type RailSession,
} from './railModel'
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
  const s = (status: RailSession['status'], subagents = 0): RailSession => ({ status, title: 'x', subagents })

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

  it('waits on subagents when the main agent is idle but subagents still run', () => {
    expect(paneState(pane({}), s('idle', 2))).toBe('subagents')
    expect(paneState(pane({ attention: 'done' }), s('idle', 1))).toBe('subagents')
    expect(paneState(pane({}), s('working', 2))).toBe('working')
    expect(paneState(pane({}), s('waiting', 2))).toBe('asked')
    expect(paneState(pane({ attention: 'done' }), s('idle', 0))).toBe('done')
  })

  it('names subagent states without guessing a word for the others', () => {
    expect(stateWord('subagents', 2)).toEqual({ key: 'workspace.subagentState.waiting', n: 2 })
    expect(stateWord('working', 1)).toEqual({ key: 'workspace.subagentState.working', n: 1 })
    expect(stateWord('working', 0)).toEqual({ key: 'workspace.rail.state.working' })
    expect(stateWord('done', 3)).toEqual({ key: 'workspace.rail.state.done' })
  })

  it('aggregates a group: failed > asked > working | subagents > starting > done > ended > idle', () => {
    expect(groupState(['idle', 'working', 'asked'])).toBe('asked')
    expect(groupState(['done', 'failed', 'asked'])).toBe('failed')
    expect(groupState(['idle', 'subagents', 'starting'])).toBe('subagents')
    expect(groupState(['working', 'subagents'])).toBe('working')
    expect(groupState(['ended', 'done', 'idle'])).toBe('done')
    expect(groupState(['idle', 'ended'])).toBe('ended')
    expect(groupState([])).toBe('idle')
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
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.open('claude', 'C:\\work\\app-wt\\feat', undefined, { tab: true })
    ws.open('shell', 'D:\\notes', undefined, { tab: true })
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
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.split(a.key, 'row')
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const rows = buildRail(input())[0]!.checkouts[0]!.rows
    expect(rows.map((r) => [r.task, r.ordinal])).toEqual([
      [null, 'Claude'],
      [null, 'Claude 2'],
      [null, 'Claude 3'],
    ])
  })

  it('puts the ordinal behind a shared session name, never on the name', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const rows = buildRail(input({ sessionOf: () => ({ status: 'idle', title: 'Fix login', subagents: 0 }) }))[0]!.checkouts[0]!.rows
    expect(rows.map((r) => [r.task, r.ordinal])).toEqual([
      ['Fix login', 'Claude'],
      ['Fix login', 'Claude 2'],
    ])
  })

  it('shows a tab without agents as one row and a home tab under the home cluster', () => {
    const ws = useWorkspaceStore()
    ws.runScript('D:\\notes', 'npm test')
    ws.open('shell', undefined, undefined, { tab: true })
    const rail = buildRail(input())
    expect(rail.map((c) => [c.key, c.root])).toEqual([
      ['plain:d:\\notes', 'D:\\notes'],
      ['home', null],
    ])
    expect(rail[0]!.checkouts[0]!.rows[0]!).toMatchObject({ kind: 'other', agent: 'npm test' })
  })

  it('gives a run pane its own row whose failed run counts as needing you', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
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
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.update(a.key, { attention: 'waiting', state: 'running' })
    const rail = buildRail(input())
    expect(rail[0]!.needs).toBe(1)
    expect(rail.flatMap((c) => c.checkouts.flatMap((k) => k.rows)).filter((r) => r.focused).map((r) => r.paneKey)).toEqual([b.key])
  })

  it('keeps remembered projects as rowless clusters after the live ones', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const rail = buildRail(input({ history: ['C:\\work\\app-wt\\feat', 'D:\\notes'] }))
    expect(rail.map((c) => [c.name, c.live])).toEqual([
      ['app', true],
      ['notes', false],
    ])
    expect(rail[0]!.history).toEqual(['C:\\work\\app-wt\\feat'])
  })

  it('groups a tab whose git lookup is pending under a provisional plain key', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'E:\\fresh', undefined, { tab: true })
    expect(buildRail(input())[0]!.key).toBe('plain:e:\\fresh')
  })

  it('keeps the tab project when a pane cds elsewhere', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.update(a.key, { cwd: 'D:\\notes', liveCwd: 'D:\\notes' })
    expect(buildRail(input())[0]!.name).toBe('app')
  })
})

describe('rail groups', () => {
  it('groups a tab with two or more terminal / run panes, shells included', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const sh = ws.split(a.key, 'row', { kind: 'term', preset: 'shell' })!
    const k = buildRail(input())[0]!.checkouts[0]!
    const tabKey = ws.tabOf(a.key)!.key
    expect(k.rows.map((r) => [r.paneKey, r.kind, r.group])).toEqual([
      [a.key, 'agent', `group:${tabKey}`],
      [sh.key, 'shell', `group:${tabKey}`],
    ])
    expect(k.groups).toMatchObject([{ key: `group:${tabKey}`, tabKey, title: 'Shell', count: 2, folded: false, tabActive: true, focused: true, paneKeys: [a.key, sh.key] }])
    expect(railItems(k).map((i) => i.key)).toEqual([`group:${tabKey}`, a.key, sh.key])
  })

  it('draws a shell member as its title over "Shell · state"', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const sh = ws.split(a.key, 'row', { kind: 'term', preset: 'shell' })!
    ws.update(sh.key, { command: 'npm run dev' })
    const row = buildRail(input())[0]!.checkouts[0]!.rows.find((r) => r.paneKey === sh.key)!
    expect(rowLines(row, 'Ready')).toEqual({ first: 'npm run dev', second: 'Shell · Ready' })
    expect(rowLines({ ...row, task: 'Shell' }, 'Ready')).toEqual({ first: 'Shell', second: 'Ready' })
  })

  it('keeps single tabs as before: an agent beside a browser, a lone shell as a tab row', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.split(a.key, 'row', { kind: 'browser', url: 'https://example.com' })
    ws.open('shell', 'C:\\work\\app', undefined, { tab: true })
    const k = buildRail(input())[0]!.checkouts[0]!
    expect(k.groups).toEqual([])
    expect(k.rows.map((r) => [r.kind, r.group, r.key.startsWith('tab:')])).toEqual([
      ['agent', null, false],
      ['other', null, true],
    ])
  })

  it('shows a lone shell running claude as a Claude row, and a tab row again once it ends', () => {
    const ws = useWorkspaceStore()
    const sh = ws.open('shell', 'C:\\work\\app', undefined, { tab: true })
    ws.update(sh.key, { agent: 'claude' })
    const row = buildRail(input())[0]!.checkouts[0]!.rows[0]!
    expect([row.kind, row.preset, row.agent, row.key]).toEqual(['agent', 'claude', 'Claude', sh.key])

    ws.update(sh.key, { agent: undefined })
    expect(buildRail(input())[0]!.checkouts[0]!.rows.map((r) => [r.kind, r.key.startsWith('tab:')])).toEqual([['other', true]])
  })

  it('shows a tab name on a single agent row and on a tab row, and titles groups', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.open('shell', 'C:\\work\\app', undefined, { tab: true })
    const c = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.split(c.key, 'row')
    ws.renameTab(ws.tabOf(a.key)!.key, 'Login bug')
    ws.renameTab(ws.tabOf(b.key)!.key, 'Dev server')
    ws.renameTab(ws.tabOf(c.key)!.key, 'Review')
    const k = buildRail(input({ sessionOf: () => ({ status: 'idle', title: 'Fix login', subagents: 0 }) }))[0]!.checkouts[0]!
    const lines = k.rows.map((r) => rowLines(r, 'Ready').first)
    expect(lines.slice(0, 2)).toEqual(['Login bug', 'Dev server'])
    expect(lines.slice(2)).toEqual(['Fix login', 'Fix login'])
    expect(k.groups.map((g) => [g.title, g.named])).toEqual([['Review', true]])
  })

  it('titles an unnamed group by its tab title callback', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.split(a.key, 'col')
    const k = buildRail(input({ tabTitleOf: () => 'Fix login' }))[0]!.checkouts[0]!
    expect(k.groups[0]!.title).toBe('Fix login')
    expect(k.groups[0]!.named).toBe(false)
  })

  it('aggregates member states, sums subagents and keeps needs counted per member', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.split(a.key, 'row')!
    const sh = ws.split(b.key, 'col', { kind: 'term', preset: 'shell' })!
    for (const p of [a, b, sh]) ws.update(p.key, { state: 'running' })
    ws.update(b.key, { attention: 'waiting' })
    const sessions: Record<string, RailSession> = {
      [a.key]: { status: 'idle', title: 'A', subagents: 2 },
      [b.key]: { status: 'waiting', title: 'B', subagents: 1 },
    }
    const rail = buildRail(input({ sessionOf: (p) => sessions[p.key] }))
    const k = rail[0]!.checkouts[0]!
    expect(k.rows.map((r) => r.state)).toEqual(['subagents', 'asked', 'idle'])
    expect(k.groups[0]).toMatchObject({ state: 'asked', subagents: 3, count: 3 })
    expect(rail[0]!.needs).toBe(1)
  })

  it('carries the folded flag and marks the group focused while the active pane is inside', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.split(a.key, 'row')
    const tabKey = ws.tabOf(a.key)!.key
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.setFolded(tabKey, true)
    const g = buildRail(input())[0]!.checkouts[0]!.groups[0]!
    expect(g).toMatchObject({ folded: true, tabActive: false, focused: false })
    ws.activateTab(tabKey)
    expect(buildRail(input())[0]!.checkouts[0]!.groups[0]).toMatchObject({ tabActive: true, focused: true })
  })

  it('leads a group with the member longest in the group state', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.split(a.key, 'row')!
    const sh = ws.split(b.key, 'col', { kind: 'term', preset: 'shell' })!
    for (const p of [a, b, sh]) ws.update(p.key, { state: 'running' })
    const sessions: Record<string, RailSession> = {
      [a.key]: { status: 'working', title: 'A', since: '2026-10-16T10:05:00Z', subagents: 0 },
      [b.key]: { status: 'working', title: 'B', since: '2026-10-16T10:00:00Z', subagents: 0 },
    }
    const g = buildRail(input({ sessionOf: (p) => sessions[p.key] }))[0]!.checkouts[0]!.groups[0]!
    expect(g).toMatchObject({ state: 'working', lead: b.key })
    const idle = buildRail(input())[0]!.checkouts[0]!.groups[0]!
    expect(idle.state).toBe('idle')
    expect(idle.paneKeys).toContain(idle.lead)
  })

  it('counts subagent waits as working in the needs-you footer', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.update(a.key, { state: 'running' })
    const list = buildAttentionList(buildRail(input({ sessionOf: () => ({ status: 'idle', title: 'A', subagents: 1 }) })))
    expect(list.footer.working).toBe(1)
    expect(list.footer.idle).toBe(0)
  })
})

describe('row twins', () => {
  const firsts = (over: Partial<RailInput> = {}) =>
    buildRail(input(over)).flatMap((c) => c.checkouts.map((k) => k.rows.map((r) => rowLines(r, 'Ready').first)))

  it('numbers rows of one checkout that would read the same, in open order', () => {
    const ws = useWorkspaceStore()
    for (let i = 0; i < 3; i++) ws.open('shell', 'C:\\work\\app', undefined, { tab: true })
    expect(firsts()).toEqual([['Shell', 'Shell 2', 'Shell 3']])
  })

  it('skips a number another row already shows', () => {
    const ws = useWorkspaceStore()
    ws.open('shell', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.open('shell', 'C:\\work\\app', undefined, { tab: true })
    ws.open('shell', 'C:\\work\\app', undefined, { tab: true })
    ws.renameTab(ws.tabOf(b.key)!.key, 'Shell 2')
    expect(firsts()).toEqual([['Shell', 'Shell 2', 'Shell 3']])
  })

  it('names shells running one command by their live folder when those differ', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const api = ws.split(a.key, 'row', { kind: 'term', preset: 'shell' })!
    const web = ws.split(api.key, 'col', { kind: 'term', preset: 'shell' })!
    ws.update(api.key, { command: 'npm run dev', liveCwd: 'C:\\work\\app\\api' })
    ws.update(web.key, { command: 'npm run dev', liveCwd: 'C:\\work\\app\\web' })
    expect(firsts()).toEqual([['Claude', 'npm run dev · api', 'npm run dev · web']])
  })

  it('falls back to numbers when the folders match, and keeps the line-2 ordinal for agents', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const s1 = ws.split(a.key, 'row', { kind: 'term', preset: 'shell' })!
    const s2 = ws.split(s1.key, 'col', { kind: 'term', preset: 'shell' })!
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    for (const p of [s1, s2]) ws.update(p.key, { command: 'npm test' })
    const rows = buildRail(input({ sessionOf: (p) => (p.preset === 'claude' ? { status: 'idle', title: 'Fix login', subagents: 0 } : undefined) }))[0]!.checkouts[0]!.rows
    expect(rows.map((r) => rowLines(r, 'Ready'))).toEqual([
      { first: 'Fix login', second: 'Claude · Ready' },
      { first: 'npm test', second: 'Shell · Ready' },
      { first: 'npm test 2', second: 'Shell · Ready' },
      { first: 'Fix login', second: 'Claude 2 · Ready' },
    ])
  })

  it('numbers within a checkout only', () => {
    const ws = useWorkspaceStore()
    ws.open('shell', 'C:\\work\\app', undefined, { tab: true })
    ws.open('shell', 'C:\\work\\app-wt\\feat', undefined, { tab: true })
    expect(firsts()).toEqual([['Shell'], ['Shell']])
  })
})

describe('tree tab stop', () => {
  it('lists visible items in screen order, skipping collapsed projects and folded members', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.split(a.key, 'row')!
    const tabKey = ws.tabOf(a.key)!.key
    const n = ws.open('shell', 'D:\\notes', undefined, { tab: true })
    const rail = buildRail(input())
    const notes = rail[1]!.checkouts[0]!.rows[0]!.key
    expect(treeIds(rail, () => false)).toEqual([headId(rail[0]!.key), `group:${tabKey}`, rowId(a.key), rowId(b.key), headId(rail[1]!.key), rowId(notes)])
    ws.setFolded(tabKey, true)
    expect(treeIds(buildRail(input()), (k) => k === rail[1]!.key)).toEqual([headId(rail[0]!.key), `group:${tabKey}`, headId(rail[1]!.key)])
    expect(notes).toBe(`tab:${ws.tabOf(n.key)!.key}`)
  })

  it('keeps the last focused item, else the focused pane, its folded group, or the first item', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.split(a.key, 'row')!
    const tabKey = ws.tabOf(a.key)!.key
    const open = () => false
    let rail = buildRail(input())
    expect(tabStopOf(rail, open, rowId(a.key))).toBe(rowId(a.key))
    expect(tabStopOf(rail, open, 'row:gone')).toBe(rowId(b.key))
    ws.setFolded(tabKey, true)
    rail = buildRail(input())
    expect(tabStopOf(rail, open, rowId(a.key))).toBe(`group:${tabKey}`)
    expect(tabStopOf(rail, () => true, null)).toBe(headId(rail[0]!.key))
    expect(tabStopOf([], open, null)).toBeNull()
  })
})

describe('checkout lines', () => {
  it('skip a lone plain folder but show branches, worktrees and remembered projects', () => {
    const ws = useWorkspaceStore()
    ws.open('shell', 'D:\\notes', undefined, { tab: true })
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.open('claude', 'C:\\work\\app-wt\\feat', undefined, { tab: true })
    const rail = buildRail(input({ history: ['E:\\old'] }))
    expect(rail.map((c) => [c.name, showsCheckouts(c)])).toEqual([
      ['notes', false],
      ['app', true],
      ['old', true],
    ])
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
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.open('shell', 'D:\\notes', undefined, { tab: true })
    const c = ws.open('claude', 'C:\\work\\app-wt\\feat', undefined, { tab: true })
    const keyOf = (k: string) => ws.tabOf(k)!.key
    expect(projectTabKeys(buildRail(input()), ws.tabs, keyOf(c.key))).toEqual([keyOf(a.key), keyOf(c.key)])
  })

  it('keeps tab open order on the strip, not the rail checkout grouping', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.open('claude', 'C:\\work\\app-wt\\feat', undefined, { tab: true })
    const c = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const keyOf = (k: string) => ws.tabOf(k)!.key
    expect(projectTabKeys(buildRail(input()), ws.tabs, keyOf(a.key))).toEqual([keyOf(a.key), keyOf(b.key), keyOf(c.key)])
  })

  it('falls back to every tab when the active tab is unknown', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.open('shell', 'D:\\notes', undefined, { tab: true })
    expect(projectTabKeys(buildRail(input()), ws.tabs, null)).toHaveLength(2)
  })

  it('numbers tabs sharing one folder and leaves single tabs bare', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    ws.open('claude', 'c:/work/app/', undefined, { tab: true })
    ws.open('shell', 'D:\\notes', undefined, { tab: true })
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
  it('maps a window rect onto a pane rect with translate + scale', () => {
    expect(flipTransform({ left: 0, top: 0, width: 100, height: 50 }, { left: 10, top: 20, width: 200, height: 100 })).toBe('translate(10px, 20px) scale(2, 2)')
  })
})

describe('needs-you list', () => {
  it('lists failed before asked, oldest first, with a footer of the rest', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const c = ws.open('claude', 'D:\\notes', undefined, { tab: true })
    ws.update(a.key, { attention: 'waiting', state: 'running' })
    ws.update(b.key, { state: 'error' })
    ws.update(c.key, { state: 'running' })
    const sessions: Record<string, RailSession> = {
      [a.key]: { status: 'waiting', title: 'A', since: '2026-10-15T10:00:00Z', subagents: 0 },
      [c.key]: { status: 'working', title: 'C', subagents: 0 },
    }
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

describe('peer messages on the rail', () => {
  const news = (over: Partial<RailPeer> = {}): RailPeer => ({ dir: 'in', kind: 'message', other: 't9', name: 'A', inside: true, peers: 1, n: 1, at: 1_000, until: 9_000, ...over })

  it('puts the pane peer on its row, never on a run row', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const r = ws.split(a.key, 'row', { kind: 'run' })!
    const rows = buildRail(input({ peerOf: () => news() }))[0]!.checkouts[0]!.rows
    expect(rows.find((x) => x.paneKey === a.key)!.peer).toMatchObject({ dir: 'in', name: 'A' })
    expect(rows.find((x) => x.paneKey === r.key)!.peer).toBeUndefined()
    expect('peer' in buildRail(input())[0]!.checkouts[0]!.rows[0]!).toBe(false)
  })

  it('leads a group with the newest member message unless a member needs you', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.split(a.key, 'row')!
    for (const p of [a, b]) ws.update(p.key, { state: 'running' })
    const byPane: Record<string, RailPeer> = { [a.key]: news({ name: 'old', at: 1_000 }), [b.key]: news({ dir: 'out', name: 'new', at: 2_000 }) }
    const peerOf = (p: Pane): RailPeer | undefined => byPane[p.key]
    expect(buildRail(input({ peerOf }))[0]!.checkouts[0]!.groups[0]!.peer).toMatchObject({ name: 'new', dir: 'out' })
    ws.update(a.key, { attention: 'waiting' })
    const g = buildRail(input({ peerOf }))[0]!.checkouts[0]!.groups[0]!
    expect(g.state).toBe('asked')
    expect(g.peer).toBeUndefined()
  })

  it('flags a project only for messages that arrive', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app', undefined, { tab: true })
    const b = ws.open('claude', 'D:\\notes', undefined, { tab: true })
    const byPane: Record<string, RailPeer> = { [a.key]: news({ dir: 'out' }), [b.key]: news({ dir: 'both', name: 'B' }) }
    const rail = buildRail(input({ peerOf: (p) => byPane[p.key] }))
    expect(rail.find((c) => c.name === 'app')!.peer).toBeUndefined()
    expect(rail.find((c) => c.name === 'notes')!.peer).toMatchObject({ dir: 'both', name: 'B' })
    const opened = buildRail(input({ peerOf: () => news({ kind: 'opened' }) }))
    expect(opened.every((c) => !c.peer)).toBe(true)
    expect(latestPeer([{ peer: news({ at: 5 }) }, {}, { peer: news({ at: 9, name: 'z' }) }])?.name).toBe('z')
  })

  it('lets needs-you keep the line: the message drops to a badge', () => {
    expect(peerSlot('asked', news())).toBe('badge')
    expect(peerSlot('failed', news())).toBe('badge')
    expect(peerSlot('working', news())).toBe('line')
    expect(peerSlot('idle', null)).toBeNull()
    expect(isPeerNews(news())).toBe(true)
    expect(isPeerNews(news({ dir: 'out' }))).toBe(false)
    expect(isPeerNews(news({ kind: 'opened' }))).toBe(false)
  })
})
