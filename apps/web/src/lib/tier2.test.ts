import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from '../stores/workspace'
import { captureLayout } from './layouts'
import { recentScripts, rememberScript } from './projects'
import { containingRoot, projectOf, rowActivity, rowStatus, shellTitle, shortAge } from './sidebarRows'
import { leaves } from './splitLayout'
import { createStartGuard } from './startGuard'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setActivePinia(createPinia())
})

describe('sidebar rows', () => {
  it('folds a `<repo>-wt/<branch>` folder back to its repo by name', () => {
    expect(projectOf('/home/me/repo-wt/fix/src')).toBe('/home/me/repo')
  })

  it('status glyph: starting, linked session, latched attention, ended; none for viewers', () => {
    const ws = useWorkspaceStore()
    const p = ws.open('claude', '/r')
    expect(rowStatus(p, undefined)?.kind).toBe('starting')
    ws.update(p.key, { state: 'running' })
    expect(rowStatus(p, { status: 'working' })).toMatchObject({ kind: 'status', status: 'working' })
    ws.update(p.key, { attention: 'done' })
    expect(rowStatus(p, { status: 'idle' })).toMatchObject({ status: 'completed', label: 'workspace.attention.done' })
    ws.update(p.key, { attention: 'waiting' })
    expect(rowStatus(p, { status: 'working' })).toMatchObject({ status: 'waiting' })
    ws.update(p.key, { state: 'exited', attention: undefined })
    expect(rowStatus(p, undefined)).toMatchObject({ status: 'completed', label: 'workspace.state.exited' })
    expect(rowStatus(ws.openBrowser('http://x.test/'), undefined)).toBeNull()
  })

  it('shell title = script line, else folder; age buckets', () => {
    const ws = useWorkspaceStore()
    const s = ws.open('shell', '/home/me/site')
    expect(shellTitle(s)).toBe('site')
    ws.update(s.key, { liveCwd: '/home/me/site/docs' })
    expect(shellTitle(s)).toBe('docs')
    ws.update(s.key, { command: 'npm run dev' })
    expect(shellTitle(s)).toBe('npm run dev')
    const now = 10_000_000
    expect(shortAge(now - 5_000, now)).toEqual({ unit: 'now' })
    expect(shortAge(now - 125_000, now)).toEqual({ unit: 'm', n: 2 })
    expect(shortAge(now - 3 * 3_600_000, now)).toEqual({ unit: 'h', n: 3 })
    expect(shortAge(now - 49 * 3_600_000, now)).toEqual({ unit: 'd', n: 2 })
    expect(rowActivity({ ...s, focusedAt: undefined }, { lastActivityAt: new Date(now).toISOString() }, now - 1000)).toBe(now)
    expect(rowActivity({ ...s, focusedAt: undefined }, undefined, undefined)).toBeUndefined()
  })
})

describe('layouts', () => {
  it('captures the project tabs with split trees; agents resume only when asked', () => {
    const ws = useWorkspaceStore()
    const agent = ws.open('claude', '/repo')
    ws.update(agent.key, { agentSessionId: '0b3c1f6e-1111-4222-8333-944445555666' })
    ws.split(agent.key, 'row', { kind: 'browser', url: 'http://localhost:3000/' })
    ws.open('shell', '/elsewhere')
    const inRepo = (p: { cwd?: string }) => p.cwd === '/repo'
    const fresh = captureLayout(ws.tabs, ws.panes, inRepo, { project: '/repo', name: ' Dev ', resume: false })!
    expect(fresh.name).toBe('Dev')
    expect(fresh.tabs).toHaveLength(1)
    expect(Object.values(fresh.panes).map((p) => p.kind).sort()).toEqual(['browser', 'term'])
    expect(Object.values(fresh.panes).some((p) => p.resume)).toBe(false)
    const resumed = captureLayout(ws.tabs, ws.panes, inRepo, { project: '/repo', name: 'Dev', resume: true })!
    expect(Object.values(resumed.panes).find((p) => p.kind === 'term')?.resume).toBe('0b3c1f6e-1111-4222-8333-944445555666')
    expect(captureLayout(ws.tabs, ws.panes, () => false, { project: '/x', name: 'n', resume: false })).toBeNull()
  })

  it('opens a layout as new tabs and reuses an already open browser / file pane', () => {
    const ws = useWorkspaceStore()
    const open = ws.openBrowser('http://localhost:3000/')
    const layout = {
      panes: {
        a: { kind: 'term' as const, preset: 'shell' as const, cwd: '/repo' },
        b: { kind: 'browser' as const, url: 'http://localhost:3000/' },
        c: { kind: 'file' as const, path: '/repo/README.md', line: 4 },
      },
      tabs: [
        { root: { dir: 'row' as const, ratio: 0.6, a: { pane: 'a' }, b: { pane: 'b' } }, focus: 'b' },
        { root: { pane: 'c' } },
      ],
    }
    expect(ws.openLayout(layout)).toBeGreaterThan(0)
    expect(ws.tabs).toHaveLength(3)
    expect(ws.panes.filter((p) => p.kind === 'browser')).toHaveLength(1)
    const first = ws.tabs[1]!
    expect(leaves(first.root)).toHaveLength(1)
    expect(ws.panes.find((p) => p.key === leaves(first.root)[0])?.preset).toBe('shell')
    expect(ws.panes.find((p) => p.kind === 'file')?.line).toBe(4)
    // Everything already open: nothing added, the reused pane takes focus.
    const before = ws.tabs.length
    expect(ws.openLayout({ panes: { b: layout.panes.b }, tabs: [{ root: { pane: 'b' } }] })).toBe(0)
    expect(ws.tabs).toHaveLength(before)
    expect(ws.activeKey).toBe(open.key)
  })

  it('keeps run panes in captured layouts and reuses the open run pane of that root', () => {
    const ws = useWorkspaceStore()
    const agent = ws.open('claude', '/repo')
    const run = ws.split(agent.key, 'col', { kind: 'run' })!
    const draft = captureLayout(ws.tabs, ws.panes, (p) => p.cwd === '/repo', { project: '/repo', name: 'Run', resume: false })!
    expect(draft.panes[run.key]).toEqual({ kind: 'run', cwd: '/repo' })
    const before = ws.panes.length
    ws.openLayout(draft)
    expect(ws.panes.filter((p) => p.kind === 'run')).toHaveLength(1)
    expect(ws.panes.length).toBe(before + 1)
  })
})

describe('scripts', () => {
  it('runScript opens a shell tab carrying the command once; recent list is per folder', () => {
    const ws = useWorkspaceStore()
    const p = ws.runScript('/repo', 'npm run hello')
    expect(p.preset).toBe('shell')
    expect(p.command).toBe('npm run hello')
    expect(p.pendingCommand).toBe('npm run hello')
    expect(ws.activeKey).toBe(p.key)
    const beside = ws.runScript('/repo', 'npm run dev', { split: { key: p.key, dir: 'row' } })
    expect(ws.tabs).toHaveLength(1)
    expect(leaves(ws.tabs[0]!.root)).toEqual([p.key, beside.key])
    rememberScript('C:\\Repo\\', 'npm run a')
    rememberScript('c:/repo', 'npm run b')
    rememberScript('c:/repo', 'npm run a')
    expect(recentScripts('C:\\repo')).toEqual(['npm run a', 'npm run b'])
  })
})

describe('provisional project root', () => {
  const repos = ['C:\\work\\app', 'C:\\work\\app\\vendor\\lib', 'D:/other']

  it('picks the deepest known repo holding the folder, ignoring case and separators', () => {
    expect(containingRoot('c:/WORK/app/src', repos)).toBe('C:\\work\\app')
    expect(containingRoot('C:\\work\\app', repos)).toBe('C:\\work\\app')
    expect(containingRoot('C:\\work\\app\\vendor\\lib\\x', repos)).toBe('C:\\work\\app\\vendor\\lib')
    expect(containingRoot('d:\\other\\', repos)).toBe('D:/other')
  })

  it('never matches a sibling that only shares a name prefix', () => {
    expect(containingRoot('C:\\work\\app2', repos)).toBeUndefined()
    expect(containingRoot('C:\\work', repos)).toBeUndefined()
  })
})

describe('open on start guard', () => {
  it('lets only the first user terminal of a project claim it', () => {
    const saved: string[][] = []
    const guard = createStartGuard([], (list) => saved.push(list))
    expect(guard.take('p1')).toBe(true)
    expect(guard.take('p1')).toBe(false)
    expect(guard.claim('c:\\app')).toBe(true)
    expect(guard.claim('c:\\app')).toBe(false)
    expect(saved.at(-1)).toEqual(['c:\\app'])
  })

  it('never treats restored or layout panes as a first terminal', () => {
    const guard = createStartGuard()
    guard.adopt(['r1', 'r2'])
    expect(guard.take('r1')).toBe(false)
    expect(guard.take('r2')).toBe(false)
    guard.mark('c:\\app')
    expect(guard.take('n1')).toBe(true)
    expect(guard.claim('c:\\app')).toBe(false)
    expect(guard.claim('c:\\other')).toBe(true)
  })

  it('remembers projects already started in this window', () => {
    expect(createStartGuard(['c:\\app']).claim('c:\\app')).toBe(false)
  })
})
