import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import en from '../i18n/en'
import vi from '../i18n/vi'
import { boxes, leaves } from '../lib/splitLayout'
import type { PaneOpenResult, PtyPreset } from '@ccm/shared'
import { openedLinkId, usePeersStore } from './peers'
import { presetOf, primaryPaneKey, tabProject, useWorkspaceStore, workCwd } from './workspace'

function keysOf(o: unknown, prefix = ''): string[] {
  if (!o || typeof o !== 'object') return [prefix]
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k))
}

describe('i18n', () => {
  it('en and vi have the same keys', () => {
    expect(keysOf(vi).sort()).toEqual(keysOf(en).sort())
  })
})

describe('workspace viewer panes', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('reuses a tab for the same url / file and jumps to the new line', () => {
    const ws = useWorkspaceStore()
    const a = ws.openBrowser('http://localhost:5173/')
    const b = ws.openBrowser('http://localhost:5173/')
    expect(b.key).toBe(a.key)
    const f = ws.openFile('C:\\repo\\src\\a.ts', 3)
    const g = ws.openFile('c:/repo/src/a.ts', 9)
    expect(g.key).toBe(f.key)
    expect(ws.panes.find((p) => p.key === f.key)?.line).toBe(9)
    expect(ws.tabs).toHaveLength(2)
    expect(ws.activeKey).toBe(f.key)
  })

  it('names a split tab after its first terminal, whichever pane has focus', () => {
    const ws = useWorkspaceStore()
    const browser = ws.openBrowser('http://localhost:5173/')
    const term = ws.split(browser.key, 'row', { kind: 'term', preset: 'claude' })!
    const file = ws.split(term.key, 'col', { kind: 'file', path: 'C:\repo\a.ts' })!
    const tab = ws.tabOf(term.key)!
    const paneOf = (k: string) => ws.panes.find((p) => p.key === k)
    for (const k of [browser.key, term.key, file.key]) {
      ws.activate(k)
      expect(primaryPaneKey(tab.root, paneOf)).toBe(term.key)
    }
    const only = ws.openFile('C:\repo\b.ts')
    const shown = ws.split(only.key, 'row', { kind: 'browser', url: '' })!
    ws.activate(shown.key)
    expect(primaryPaneKey(ws.tabOf(only.key)!.root, paneOf)).toBe(only.key)
  })

  it('follows the shell folder without persisting it', async () => {
    const ws = useWorkspaceStore()
    const term = ws.open('shell', 'C:\repo')
    ws.update(term.key, { sessionId: 's1', liveCwd: 'C:\repo\web' })
    expect(workCwd(ws.panes[0]!)).toBe('C:\repo\web')
    expect(ws.split(term.key, 'row')!.cwd).toBe('C:\repo\web')
    await nextTick()
    const saved = JSON.parse(sessionStorage.getItem('ccm.workspace.panes')!)
    expect(saved.panes[0].cwd).toBe('C:\repo')
    expect(saved.panes[0].liveCwd).toBeUndefined()
  })

  it('splits a viewer next to a pane and keeps one Changes pane per repo', () => {
    const ws = useWorkspaceStore()
    const term = ws.open('shell', 'C:\\repo')
    const browser = ws.split(term.key, 'row', { kind: 'browser', url: '' })!
    expect(leaves(ws.tabOf(term.key)!.root)).toEqual([term.key, browser.key])
    const c1 = ws.openChanges('C:\\repo')
    ws.update(c1.key, { root: 'C:\\repo' })
    expect(ws.openChanges('c:\\repo').key).toBe(c1.key)
  })

  it('persists viewer panes and restores them from the last workspace', async () => {
    const ws = useWorkspaceStore()
    ws.openBrowser('C:\\repo\\index.html', { cwd: 'C:\\repo' })
    ws.openFile('C:\\repo\\a.ts', 4)
    ws.openChanges('C:\\repo')
    await nextTick()
    const saved = JSON.parse(sessionStorage.getItem('ccm.workspace.panes')!)
    expect(saved.panes.map((p: { kind: string }) => p.kind)).toEqual(['browser', 'file', 'changes'])

    sessionStorage.clear()
    setActivePinia(createPinia())
    const next = useWorkspaceStore()
    expect(next.last?.panes).toHaveLength(3)
    next.restoreLast()
    expect(next.panes.map((p) => [p.kind, p.url ?? p.path ?? p.cwd, p.line])).toEqual([
      ['browser', 'C:\\repo\\index.html', undefined],
      ['file', 'C:\\repo\\a.ts', 4],
      ['changes', 'C:\\repo', undefined],
    ])
  })

  it('drops stored viewer panes with unusable fields', () => {
    localStorage.setItem(
      'ccm.workspace.last',
      JSON.stringify({
        at: '',
        panes: [
          { key: 'a', preset: 'shell', kind: 'browser', url: 'javascript:alert(1)' },
          { key: 'b', preset: 'shell', kind: 'file', path: 'relative/x.ts' },
          { key: 'c', preset: 'shell', kind: 'file', path: '/abs/x.ts', line: 2 },
        ],
        tabs: [{ key: 't', root: { pane: 'c' }, focus: 'c' }],
      }),
    )
    const ws = useWorkspaceStore()
    expect(ws.last?.panes.map((p) => p.key)).toEqual(['c'])
  })

  it('sends to the agent pane in the same tab, else the most recently focused one', () => {
    const ws = useWorkspaceStore()
    const claude = ws.open('claude', 'C:\\repo')
    ws.update(claude.key, { state: 'running' })
    const browser = ws.split(claude.key, 'row', { kind: 'browser', url: '' })!
    expect(ws.resolveAgentPane(browser.key)).toEqual({ pane: expect.objectContaining({ key: claude.key }) })

    const lone = ws.openBrowser('http://localhost:3000/')
    expect('pane' in ws.resolveAgentPane(lone.key)).toBe(true)

    ws.insertInto(claude.key, 'hello')
    expect(ws.insertRequest).toMatchObject({ paneKey: claude.key, text: 'hello' })
    expect(ws.activeKey).toBe(claude.key)
  })

  it('treats a shell running claude / codex as that agent until it ends', () => {
    const ws = useWorkspaceStore()
    const shell = ws.open('shell', 'C:\\repo')
    ws.update(shell.key, { state: 'running' })
    const browser = ws.split(shell.key, 'row', { kind: 'browser', url: '' })!
    expect(presetOf(shell)).toBe('shell')
    expect(ws.resolveAgentPane(browser.key)).toEqual({ choices: [] })

    ws.update(shell.key, { agent: 'codex' })
    expect(presetOf(shell)).toBe('codex')
    expect(ws.resolveAgentPane(browser.key)).toEqual({ pane: expect.objectContaining({ key: shell.key }) })

    ws.update(shell.key, { agent: undefined })
    expect(presetOf(shell)).toBe('shell')
    expect(presetOf({ preset: 'claude', agent: 'codex' })).toBe('claude')
  })
})

describe('file viewers', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('every file gets its own viewer; reopening one jumps to it', () => {
    const ws = useWorkspaceStore()
    const a = ws.openFile('C:\repo\a.ts')
    const b = ws.openFile('C:\repo\b.ts')
    const c = ws.openFile('C:\repo\c.ts')
    expect(new Set([a.key, b.key, c.key]).size).toBe(3)
    expect(ws.panes.filter((p) => p.kind === 'file').map((p) => p.path)).toEqual(['C:\repo\a.ts', 'C:\repo\b.ts', 'C:\repo\c.ts'])
    expect(ws.openFile('C:\repo\a.ts', 3).key).toBe(a.key)
    expect(a.line).toBe(3)
    expect(ws.activeKey).toBe(a.key)
  })
})

describe('log panes', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('opens one Log pane per repo and selects a commit', () => {
    const ws = useWorkspaceStore()
    const a = ws.openLog('/repo', { select: 'abcd1234' })
    expect(a.kind).toBe('log')
    expect(a.select).toBe('abcd1234')
    const b = ws.openLog('/repo')
    expect(b.key).toBe(a.key)
    ws.update(a.key, { root: '/repo' })
    expect(ws.openLog('/repo', { select: 'ffff' }).select).toBe('ffff')
    expect(ws.panes.filter((p) => p.kind === 'log')).toHaveLength(1)
  })

  it('persists and restores a Log pane', async () => {
    const ws = useWorkspaceStore()
    ws.openLog('/repo')
    await nextTick()
    sessionStorage.clear()
    setActivePinia(createPinia())
    const next = useWorkspaceStore()
    next.restoreLast()
    expect(next.panes.map((p) => [p.kind, p.cwd])).toEqual([['log', '/repo']])
  })
})

describe('tab project', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('is the folder a tab was opened for and never follows a cd', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/work/app')
    ws.update(a.key, { liveCwd: 'C:/work/other' })
    const b = ws.split(a.key, 'row')!
    expect(ws.tabOf(b.key)!.project).toBe('C:/work/app')
    expect(ws.tabs).toHaveLength(1)
  })

  it('new viewer and script tabs take their folder; layouts take the layout project', () => {
    const ws = useWorkspaceStore()
    const s = ws.runScript('C:/work/api', 'npm test')
    expect(ws.tabOf(s.key)!.project).toBe('C:/work/api')
    ws.openLayout({ project: 'C:/work/web', panes: { x: { kind: 'term', preset: 'shell', cwd: 'C:/work/web/src' } }, tabs: [{ root: { pane: 'x' } }] })
    expect(ws.tabs.at(-1)!.project).toBe('C:/work/web')
  })

  it('falls back to the primary pane folder for tabs saved before v38', () => {
    const ws = useWorkspaceStore()
    const p = ws.open('shell', 'D:/notes')
    const tab = { ...ws.tabOf(p.key)!, project: undefined }
    expect(tabProject(tab, (k) => ws.panes.find((x) => x.key === k))).toBe('D:/notes')
  })

  it('cycles only inside the given scope', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/a', undefined, { tab: true })
    ws.open('claude', 'C:/b', undefined, { tab: true })
    const c = ws.open('claude', 'C:/a', undefined, { tab: true })
    const scope = [ws.tabOf(a.key)!.key, ws.tabOf(c.key)!.key]
    ws.cycleTab(1, scope)
    expect(ws.activeKey).toBe(a.key)
  })

  it('enters the scope at its first tab going forward and its last going back', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/a', undefined, { tab: true })
    const c = ws.open('claude', 'C:/a', undefined, { tab: true })
    const b = ws.open('claude', 'C:/b', undefined, { tab: true })
    const scope = [ws.tabOf(a.key)!.key, ws.tabOf(c.key)!.key]
    ws.cycleTab(-1, scope)
    expect(ws.activeKey).toBe(c.key)
    ws.activate(b.key)
    ws.cycleTab(1, scope)
    expect(ws.activeKey).toBe(a.key)
  })

})

describe('pane drag', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('moves a pane into another tab and drops the tab it left empty', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/app')
    const b = ws.open('claude', 'C:/app')
    ws.movePane(b.key, a.key, 'right')
    expect(ws.tabs).toHaveLength(1)
    expect(leaves(ws.tabs[0]!.root)).toEqual([a.key, b.key])
    expect(ws.activeKey).toBe(b.key)
  })

  it('merges a whole tab and keeps the target project', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/app')
    const b = ws.open('claude', 'C:/other')
    const c = ws.split(b.key, 'col')!
    ws.mergeTab(ws.tabOf(b.key)!.key, a.key, 'left')
    expect(ws.tabs).toHaveLength(1)
    expect(leaves(ws.tabs[0]!.root)).toEqual([b.key, c.key, a.key])
    expect(ws.tabs[0]!.project).toBe('C:/app')
    expect(ws.activeKey).toBe(c.key)
  })

  it('swaps panes of one tab only', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/app')
    const b = ws.split(a.key, 'row')!
    const other = ws.open('shell', 'C:/app', undefined, { tab: true })
    ws.swapPanes(a.key, b.key)
    expect(leaves(ws.tabOf(a.key)!.root)).toEqual([b.key, a.key])
    ws.swapPanes(a.key, other.key)
    expect(ws.tabs).toHaveLength(2)
  })

  it('detaches a pane into a tab of its own after its old tab', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/app')
    const b = ws.split(a.key, 'row')!
    ws.open('shell', 'C:/x')
    ws.detachPane(b.key)
    expect(ws.tabs).toHaveLength(3)
    expect(ws.tabs[1]!.root).toEqual({ pane: b.key })
    expect(ws.tabs[1]!.project).toBe('C:/app')
    ws.detachPane(b.key)
    expect(ws.tabs).toHaveLength(3)
  })
})

describe('new terminals join their project tab', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('splits the project tab beside the focused pane, also from a sub-folder', () => {
    const ws = useWorkspaceStore()
    ws.canvasSize = { w: 1600, h: 900 }
    const a = ws.open('claude', 'C:/work/app')
    const b = ws.open('claude', 'C:/work/app/')
    const c = ws.open('shell', 'C:/work/app/src')
    expect(ws.tabs).toHaveLength(1)
    expect(leaves(ws.tabs[0]!.root)).toEqual([a.key, b.key, c.key])
    // a | b on a wide canvas, then b (800 × 900) halves downward: the layout of two columns, right one stacked.
    expect(ws.tabs[0]!.root).toMatchObject({ dir: 'row', b: { dir: 'col' } })
    expect(ws.activeKey).toBe(c.key)
  })

  it('three terminals of one project: one column on the left, two stacked on the right', () => {
    const ws = useWorkspaceStore()
    ws.canvasSize = { w: 1600, h: 900 }
    const [a, b, c] = [1, 2, 3].map(() => ws.open('claude', 'C:/work/app'))
    expect(ws.tabs).toHaveLength(1)
    expect(ws.tabs[0]!.root).toEqual({ dir: 'row', ratio: 0.5, a: { pane: a!.key }, b: { dir: 'col', ratio: 0.5, a: { pane: b!.key }, b: { pane: c!.key } } })
  })

  it('four terminals of one project fill a 2 × 2 grid', () => {
    const ws = useWorkspaceStore()
    ws.canvasSize = { w: 1600, h: 900 }
    const keys = [1, 2, 3, 4].map(() => ws.open('shell', 'C:/work/app').key)
    const [a, b, c, d] = keys
    expect(ws.tabs).toHaveLength(1)
    expect(ws.tabs[0]!.root).toEqual({
      dir: 'row',
      ratio: 0.5,
      a: { dir: 'col', ratio: 0.5, a: { pane: a }, b: { pane: d } },
      b: { dir: 'col', ratio: 0.5, a: { pane: b }, b: { pane: c } },
    })
    expect(ws.activeKey).toBe(d)
    const all = boxes(ws.tabs[0]!.root)
    for (const k of keys) expect(all.get(k)).toMatchObject({ w: 0.5, h: 0.5 })
  })

  it('keeps adding to the group until panes would get too small, then starts a tab', () => {
    const ws = useWorkspaceStore()
    ws.canvasSize = { w: 600, h: 400 }
    // 600 × 400 halves once each way (300 × 200 ≥ 220 × 140): a 2 × 2 grid is full, the 5th starts a tab.
    for (let i = 0; i < 5; i++) ws.open('shell', 'C:/work/app')
    expect(ws.tabs.map((t) => leaves(t.root).length)).toEqual([4, 1])
    ws.open('shell', 'C:/work/app')
    expect(ws.tabs.map((t) => leaves(t.root).length)).toEqual([4, 2])
  })

  it('opens another project in its own tab and goes back to the right tab later', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/work/app')
    const o = ws.open('claude', 'C:/work/app-wt/feat')
    expect(ws.tabs).toHaveLength(2)
    const b = ws.open('claude', 'C:/work/app')
    expect(ws.tabOf(b.key)).toBe(ws.tabOf(a.key))
    expect(ws.tabOf(o.key)!.root).toEqual({ pane: o.key })
    expect(ws.activeKey).toBe(b.key)
  })

  it('takes a tab of its own when no pane has room or one is asked for', () => {
    const ws = useWorkspaceStore()
    ws.canvasSize = { w: 400, h: 250 }
    ws.open('claude', 'C:/work/app')
    ws.open('claude', 'C:/work/app')
    expect(ws.tabs).toHaveLength(2)
    ws.canvasSize = { w: 1600, h: 900 }
    ws.open('shell', 'C:/work/app', undefined, { tab: true })
    expect(ws.tabs).toHaveLength(3)
  })
})

describe('panes opened by an agent', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  const keyOf = (r: PaneOpenResult): string => (r.ok ? r.paneKey : '')

  function caller(ws: ReturnType<typeof useWorkspaceStore>, cwd = 'C:/work/app') {
    const a = ws.open('claude', cwd)
    ws.update(a.key, { sessionId: 'host-a', state: 'running' })
    return a
  }

  it('resumes a session: reuses its open pane, refuses one live elsewhere, else opens a resumed pane', () => {
    const ws = useWorkspaceStore()
    const id = '0d6f6a52-1b2c-4d3e-8f90-123456789abc'
    const other = ws.open('shell', 'C:/work/other')
    const res = ws.openFromAgent({ id: 't1', preset: 'claude', cwd: 'C:/work/app', resume: id })
    const pane = ws.panes.find((p) => p.key === keyOf(res))!
    expect(pane).toMatchObject({ preset: 'claude', resume: id, agentSessionId: id, openTicket: 't1' })
    expect(ws.activeKey).toBe(pane.key)
    ws.activate(other.key)
    const again = ws.openFromAgent({ id: 't2', preset: 'claude', cwd: 'C:/work/app', resume: id })
    expect(keyOf(again)).toBe(pane.key)
    expect(ws.activeKey).toBe(pane.key)
    expect(ws.panes).toHaveLength(2)
    const live = '1d6f6a52-1b2c-4d3e-8f90-123456789abc'
    expect(ws.openFromAgent({ id: 't3', preset: 'codex', cwd: 'C:/work/app', resume: live }, { liveElsewhere: (s) => s === live })).toEqual({ ok: false, error: 'live' })
    expect(ws.openFromAgent({ id: 't4', preset: 'shell', cwd: 'C:/work/app', resume: id })).toEqual({ ok: false, error: 'resume' })
    expect(ws.openFromAgent({ id: 't5', preset: 'claude', cwd: 'C:/work/app', resume: '--dangerously-skip-permissions' })).toEqual({ ok: false, error: 'resume' })
    expect(ws.panes).toHaveLength(2)
  })

  it('splits beside the calling pane without taking focus', () => {
    const ws = useWorkspaceStore()
    ws.canvasSize = { w: 1600, h: 900 }
    const a = caller(ws)
    const other = ws.open('shell', 'C:/work/other')
    const res = ws.openFromAgent({ id: 'ticket-1', from: 'host-a', preset: 'claude', cwd: 'C:/work/app', prompt: 'fix the build' })
    expect(res.ok).toBe(true)
    const key = keyOf(res)
    expect(leaves(ws.tabOf(a.key)!.root)).toEqual([a.key, key])
    expect(ws.tabOf(a.key)!.focus).toBe(a.key)
    expect(ws.activeKey).toBe(other.key)
    expect(ws.panes.find((p) => p.key === key)).toMatchObject({ preset: 'claude', cwd: 'C:/work/app', state: 'starting', openTicket: 'ticket-1', prefill: 'fix the build' })

    ws.activate(a.key)
    const next = keyOf(ws.openFromAgent({ id: 'ticket-2', from: 'host-a', preset: 'codex', cwd: 'C:/work/app' }))
    expect(ws.tabOf(next)).toBe(ws.tabOf(a.key))
    expect(ws.activeKey).toBe(a.key)
    expect(ws.tabOf(a.key)!.focus).toBe(a.key)
  })

  it('opens a background tab of the caller project when there is no room', () => {
    const ws = useWorkspaceStore()
    ws.canvasSize = { w: 400, h: 250 }
    const a = caller(ws)
    const key = keyOf(ws.openFromAgent({ id: 't', from: 'host-a', preset: 'claude', cwd: 'C:/work/app/sub' }))
    expect(ws.tabs).toHaveLength(2)
    expect(ws.tabOf(key)!.root).toEqual({ pane: key })
    expect(ws.tabOf(key)!.project).toBe('C:/work/app')
    expect(ws.activeKey).toBe(a.key)

    ws.canvasSize = { w: 0, h: 0 }
    const hidden = keyOf(ws.openFromAgent({ id: 't2', from: 'host-a', preset: 'shell', cwd: 'C:/work/app' }))
    expect(ws.tabs).toHaveLength(3)
    expect(ws.tabOf(hidden)!.root).toEqual({ pane: hidden })
    expect(ws.activeKey).toBe(a.key)
  })

  it('without a calling pane joins the project tab and becomes active', () => {
    const ws = useWorkspaceStore()
    ws.canvasSize = { w: 1600, h: 900 }
    const a = caller(ws)
    ws.open('shell', 'C:/work/other')
    const key = keyOf(ws.openFromAgent({ id: 't', preset: 'codex', cwd: 'C:/work/app' }))
    expect(ws.tabOf(key)).toBe(ws.tabOf(a.key))
    expect(ws.activeKey).toBe(key)
    const gone = keyOf(ws.openFromAgent({ id: 't2', from: 'host-gone', preset: 'claude', cwd: 'D:/elsewhere' }))
    expect(ws.tabOf(gone)!.root).toEqual({ pane: gone })
    expect(ws.tabOf(gone)!.project).toBe('D:/elsewhere')
    expect(ws.activeKey).toBe(gone)
  })

  it('never prefills a shell and cleans the prompt', () => {
    const ws = useWorkspaceStore()
    const shell = keyOf(ws.openFromAgent({ id: 't', preset: 'shell', cwd: 'C:/work/app', prompt: 'rm -rf /' }))
    expect(ws.panes.find((p) => p.key === shell)).toMatchObject({ preset: 'shell', openTicket: 't' })
    expect(ws.panes.find((p) => p.key === shell)!.prefill).toBeUndefined()
    const blank = keyOf(ws.openFromAgent({ id: 't2', preset: 'claude', cwd: 'C:/work/app', prompt: ' \u0007 ' }))
    expect(ws.panes.find((p) => p.key === blank)!.prefill).toBeUndefined()
    const dirty = keyOf(ws.openFromAgent({ id: 't3', preset: 'claude', cwd: 'C:/work/app', prompt: 'a\u001b[2Jb\r\nc' }))
    expect(ws.panes.find((p) => p.key === dirty)!.prefill).toBe('a[2Jb\nc')
  })

  it('refuses an unknown preset or an empty folder', () => {
    const ws = useWorkspaceStore()
    expect(ws.openFromAgent({ id: 't', preset: 'bash' as PtyPreset, cwd: 'C:/work/app' })).toEqual({ ok: false, error: 'preset' })
    expect(ws.openFromAgent({ id: 't', preset: 'claude', cwd: '  ' })).toEqual({ ok: false, error: 'cwd' })
    expect(ws.openFromAgent({ id: 't', preset: 'claude', cwd: 42 as unknown as string })).toEqual({ ok: false, error: 'cwd' })
    expect(ws.panes).toHaveLength(0)
    expect(ws.tabs).toHaveLength(0)
  })

  it('keeps the ticket and the prompt out of storage', async () => {
    const ws = useWorkspaceStore()
    caller(ws)
    const key = keyOf(ws.openFromAgent({ id: 'secret-ticket', from: 'host-a', preset: 'claude', cwd: 'C:/work/app', prompt: 'secret prompt' }))
    ws.update(key, { sessionId: 'host-b', state: 'running' })
    await nextTick()
    const session = sessionStorage.getItem('ccm.workspace.panes')!
    const last = localStorage.getItem('ccm.workspace.last')!
    expect(JSON.parse(session).panes.map((p: { key: string }) => p.key)).toContain(key)
    for (const raw of [session, last]) {
      expect(raw).not.toContain('secret-ticket')
      expect(raw).not.toContain('secret prompt')
      expect(raw).not.toContain('openTicket')
      expect(raw).not.toContain('prefill')
    }

    setActivePinia(createPinia())
    const next = useWorkspaceStore()
    const restored = next.panes.find((p) => p.key === key)!
    expect(restored.sessionId).toBe('host-b')
    expect(restored.openTicket).toBeUndefined()
    expect(restored.prefill).toBeUndefined()
  })
})

describe('pane zoom', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  function pair(ws: ReturnType<typeof useWorkspaceStore>) {
    const a = ws.open('shell', 'C:/app')
    const b = ws.split(a.key, 'row')!
    return { a, b, tab: ws.tabOf(a.key)! }
  }

  it('zooms only a pane of a split tab and toggles back', () => {
    const ws = useWorkspaceStore()
    const lone = ws.open('shell', 'C:/lone', undefined, { tab: true })
    expect(ws.toggleZoom(lone.key)).toBe(false)
    expect(ws.tabOf(lone.key)!.zoom).toBeUndefined()
    const { a, tab } = pair(ws)
    expect(ws.toggleZoom(a.key)).toBe(true)
    expect(tab.zoom).toBe(a.key)
    expect(tab.focus).toBe(a.key)
    expect(ws.activeKey).toBe(a.key)
    expect(ws.toggleZoom(a.key)).toBe(false)
    expect(tab.zoom).toBeUndefined()
    ws.toggleZoom(a.key)
    ws.clearZoom(tab.key)
    expect(tab.zoom).toBeUndefined()
  })

  it('unzooms when another pane of that tab takes focus, not for other tabs', () => {
    const ws = useWorkspaceStore()
    const { a, b, tab } = pair(ws)
    const other = ws.open('shell', 'C:/other', undefined, { tab: true })
    ws.toggleZoom(a.key)
    ws.activate(a.key)
    expect(tab.zoom).toBe(a.key)
    ws.activate(other.key)
    expect(tab.zoom).toBe(a.key)
    ws.activateTab(tab.key)
    expect(ws.activeKey).toBe(a.key)
    ws.activate(b.key)
    expect(tab.zoom).toBeUndefined()
  })

  it('unzooms when the layout of the tab changes', () => {
    const ws = useWorkspaceStore()
    const { a, b, tab } = pair(ws)
    const steps: Array<() => void> = [
      () => ws.split(a.key, 'col'),
      () => ws.swapPanes(a.key, b.key),
      () => ws.movePane(b.key, a.key, 'left'),
      () => ws.remove(ws.panes.at(-1)!.key),
    ]
    for (const step of steps) {
      ws.toggleZoom(a.key)
      expect(tab.zoom).toBe(a.key)
      step()
      expect(tab.zoom).toBeUndefined()
    }
    ws.toggleZoom(a.key)
    ws.detachPane(b.key)
    expect(ws.tabOf(a.key)!.zoom).toBeUndefined()
  })

  it('keeps a saved zoom only when it is one of the tab panes', () => {
    const tabs = [
      { key: 't1', root: { dir: 'row', ratio: 0.5, a: { pane: 'p1' }, b: { pane: 'p2' } }, focus: 'p2', zoom: 'p1' },
      { key: 't2', root: { dir: 'row', ratio: 0.5, a: { pane: 'p3' }, b: { pane: 'p4' } }, focus: 'p3', zoom: 'gone' },
    ]
    const panes = ['p1', 'p2', 'p3', 'p4'].map((key) => ({ key, preset: 'shell', kind: 'browser', url: '' }))
    sessionStorage.setItem('ccm.workspace.panes', JSON.stringify({ panes, tabs, active: 'p1' }))
    const ws = useWorkspaceStore()
    expect(ws.tabs[0]!.zoom).toBe('p1')
    expect(ws.tabs[0]!.focus).toBe('p1')
    expect(ws.tabs[1]!.zoom).toBeUndefined()
  })
})

describe('reopen closed panes', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  const id = '0d6f6a52-1b2c-4d3e-8f90-123456789abc'
  const never = (): boolean => false

  it('brings a whole tab back where it was, with its layout, name and agent session', () => {
    const ws = useWorkspaceStore()
    const claude = ws.open('claude', 'C:/app')
    ws.update(claude.key, { agentSessionId: id, state: 'running' })
    const shell = ws.split(claude.key, 'col', { kind: 'term', preset: 'shell' })!
    ws.update(shell.key, { liveCwd: 'C:/app/web' })
    const tab = ws.tabOf(claude.key)!
    ws.renameTab(tab.key, 'Build')
    ws.open('shell', 'C:/other', undefined, { tab: true })
    ws.setClosedNamer((p) => `name:${p.preset}`)
    ws.requestClose([claude.key, shell.key], never)
    expect(ws.tabs).toHaveLength(1)
    expect(ws.closedStack).toHaveLength(1)
    expect(ws.closedStack[0]!.tabs[0]!.panes.map((p) => p.name)).toEqual(['name:claude', 'name:shell'])

    const res = ws.reopenClosed()!
    expect(res.from).toEqual([claude.key, shell.key])
    expect(ws.tabs).toHaveLength(2)
    const back = ws.tabs[0]!
    expect(back.name).toBe('Build')
    expect(back.project).toBe('C:/app')
    expect(back.root).toEqual({ dir: 'col', ratio: 0.5, a: { pane: res.keys[0] }, b: { pane: res.keys[1] } })
    expect(ws.panes.find((p) => p.key === res.keys[0])).toMatchObject({ preset: 'claude', cwd: 'C:/app', resume: id, agentSessionId: id, state: 'starting' })
    const fresh = ws.panes.find((p) => p.key === res.keys[1])!
    expect(fresh).toMatchObject({ preset: 'shell', cwd: 'C:/app/web' })
    expect(fresh.resume).toBeUndefined()
    expect(ws.activeKey).toBe(res.keys[1])
    expect(ws.closedStack).toHaveLength(0)
    expect(ws.reopenClosed()).toBeNull()
  })

  it('puts a pane back beside its sibling, on the same side', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('shell', 'C:/app')
    const b = ws.split(a.key, 'row')!
    ws.setRatio(ws.tabOf(a.key)!.key, '', 0.3)
    ws.requestClose([a.key], never)
    expect(ws.closedStack[0]!.loose[0]!.anchor).toMatchObject({ siblingKey: b.key, dir: 'row', side: 'a', ratio: 0.3 })
    const first = ws.reopenClosed()!
    expect(ws.tabs).toHaveLength(1)
    expect(ws.tabs[0]!.root).toEqual({ dir: 'row', ratio: 0.3, a: { pane: first.keys[0] }, b: { pane: b.key } })

    const c = ws.split(b.key, 'col')!
    ws.requestClose([c.key], never)
    const second = ws.reopenClosed()!
    expect(leaves(ws.tabs[0]!.root)).toEqual([first.keys[0], b.key, second.keys[0]])
    expect(ws.tabs[0]!.root).toMatchObject({ b: { dir: 'col', a: { pane: b.key }, b: { pane: second.keys[0] } } })
    expect(ws.activeKey).toBe(second.keys[0])
  })

  it('rebuilds several panes closed together from one tab exactly', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('shell', 'C:/app')
    const b = ws.split(a.key, 'row')!
    const c = ws.split(b.key, 'col')!
    const before = JSON.parse(JSON.stringify(ws.tabs[0]!.root))
    ws.requestClose([b.key, c.key], never)
    expect(ws.tabs[0]!.root).toEqual({ pane: a.key })
    const res = ws.reopenClosed()!
    const map = new Map(res.from.map((k, i) => [k, res.keys[i]!]))
    const remap = (n: { pane?: string; a?: unknown; b?: unknown }): unknown =>
      n.pane ? { pane: map.get(n.pane) ?? n.pane } : { ...n, a: remap(n.a as object), b: remap(n.b as object) }
    expect(ws.tabs[0]!.root).toEqual(remap(before))
  })

  it('opens a tab of its own when the sibling is gone', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('shell', 'C:/app')
    const b = ws.split(a.key, 'row')!
    ws.requestClose([a.key], never)
    ws.remove(b.key)
    const res = ws.reopenClosed()!
    expect(ws.tabs).toHaveLength(1)
    expect(ws.tabs[0]!.root).toEqual({ pane: res.keys[0] })
    expect(ws.tabs[0]!.project).toBe('C:/app')
  })

  it('reopens viewers with their url, file and line', () => {
    const ws = useWorkspaceStore()
    const page = ws.openBrowser('http://localhost:5173/')
    const file = ws.split(page.key, 'row', { kind: 'file', path: 'C:/app/a.ts', line: 7 })!
    ws.requestClose([page.key, file.key], never)
    const res = ws.reopenClosed()!
    expect(res.keys.map((k) => ws.panes.find((p) => p.key === k)).map((p) => [p?.kind, p?.url ?? p?.path, p?.line])).toEqual([
      ['browser', 'http://localhost:5173/', undefined],
      ['file', 'C:/app/a.ts', 7],
    ])
  })

  it('records user closes only, after a confirm, never on cancel or for dropped panes', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('shell', 'C:/app', undefined, { tab: true })
    const b = ws.open('shell', 'C:/b', undefined, { tab: true })
    const c = ws.open('shell', 'C:/c', undefined, { tab: true })
    ws.remove(a.key)
    ws.requestClose([b.key], never, { record: false })
    expect(ws.closedStack).toHaveLength(0)
    ws.requestClose([c.key], () => true)
    expect(ws.pendingClose).toEqual([c.key])
    ws.cancelClose()
    expect(ws.closedStack).toHaveLength(0)
    ws.requestClose([c.key], () => true)
    ws.confirmClose()
    expect(ws.closedStack).toHaveLength(1)
    expect(ws.panes).toHaveLength(0)
  })

  it('keeps the last ten closes', () => {
    const ws = useWorkspaceStore()
    const keys = Array.from({ length: 12 }, (_, i) => ws.open('shell', `C:/p${i}`, undefined, { tab: true }).key)
    for (const k of keys) ws.requestClose([k], never)
    expect(ws.closedStack).toHaveLength(10)
    expect(ws.closedStack[0]!.tabs[0]!.panes[0]!.cwd).toBe('C:/p2')
    expect(ws.reopenClosed()!.from).toEqual([keys[11]])
  })

  it('does not start a second pane for an agent session that is open again', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:/app')
    ws.update(a.key, { agentSessionId: id, state: 'running' })
    ws.requestClose([a.key], never)
    const again = ws.resumeSession('claude', 'C:/app', id)
    ws.update(again.key, { state: 'running' })
    expect(ws.reopenClosed()).toEqual({ keys: [], from: [] })
    expect(ws.panes).toHaveLength(1)
  })
})

describe('opened by another pane', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  const keyOf = (r: PaneOpenResult): string => (r.ok ? r.paneKey : '')

  function opened(ws: ReturnType<typeof useWorkspaceStore>) {
    ws.canvasSize = { w: 1600, h: 900 }
    const a = ws.open('claude', 'C:/work/app')
    ws.update(a.key, { sessionId: 'host-a', state: 'running' })
    const b = keyOf(ws.openFromAgent({ id: 't1', from: 'host-a', preset: 'claude', cwd: 'C:/work/app' }))
    ws.update(b, { sessionId: 'host-b', state: 'running' })
    return { a: a.key, b }
  }

  it('remembers the calling pane, never for a deeplink', () => {
    const ws = useWorkspaceStore()
    const { a, b } = opened(ws)
    expect(ws.panes.find((p) => p.key === b)!.openedBy).toBe(a)
    const deeplink = keyOf(ws.openFromAgent({ id: 't2', preset: 'claude', cwd: 'C:/work/app' }))
    expect(ws.panes.find((p) => p.key === deeplink)!.openedBy).toBeUndefined()
    const lost = keyOf(ws.openFromAgent({ id: 't3', from: 'host-gone', preset: 'claude', cwd: 'C:/work/app' }))
    expect(ws.panes.find((p) => p.key === lost)!.openedBy).toBeUndefined()
  })

  it('links the two sessions once both are known and tells the opened pane once', async () => {
    const ws = useWorkspaceStore()
    const peers = usePeersStore()
    const { a, b } = opened(ws)
    await nextTick()
    expect(peers.list).toHaveLength(0)
    ws.update(a, { terminalId: 'ta' })
    await nextTick()
    expect(peers.list).toHaveLength(0)
    ws.update(b, { terminalId: 'tb' })
    await nextTick()
    expect(peers.list).toEqual([expect.objectContaining({ id: openedLinkId('ta', 'tb'), kind: 'opened', a: 'ta', b: 'tb', ab: 1, ba: 0, lastDir: 'ab' })])
    expect(peers.recentOf('tb')).toMatchObject({ dir: 'in', kind: 'opened', others: ['ta'] })
    expect(peers.roleOf('ta').opened).toEqual(['tb'])
    expect(peers.pulses).toHaveLength(1)
    ws.update(a, { focusedAt: 1 })
    ws.update(b, { terminalId: 'tb' })
    await nextTick()
    expect(peers.pulses).toHaveLength(1)
  })

  it('keeps the link quiet after a reload', async () => {
    const ws = useWorkspaceStore()
    const { a, b } = opened(ws)
    await nextTick()
    expect(JSON.parse(sessionStorage.getItem('ccm.workspace.panes')!).panes.find((p: { key: string }) => p.key === b).openedBy).toBe(a)
    expect(localStorage.getItem('ccm.workspace.last')).not.toContain('openedBy')

    setActivePinia(createPinia())
    const next = useWorkspaceStore()
    const peers = usePeersStore()
    expect(next.panes.find((p) => p.key === b)!.openedBy).toBe(a)
    next.update(a, { terminalId: 'ta' })
    next.update(b, { terminalId: 'tb' })
    await nextTick()
    expect(peers.list.map((l) => l.id)).toEqual([openedLinkId('ta', 'tb')])
    expect(peers.recentOf('tb')).toBeNull()
    expect(peers.pulses).toHaveLength(0)
  })

  it('drops the link with a closed pane and brings it back, quietly, on undo', async () => {
    const ws = useWorkspaceStore()
    const peers = usePeersStore()
    const { a, b } = opened(ws)
    ws.update(a, { terminalId: 'ta' })
    ws.update(b, { terminalId: 'tb' })
    await nextTick()
    const pulses = peers.pulses.length
    ws.requestClose([a], () => false)
    await nextTick()
    expect(peers.list).toHaveLength(0)
    expect(ws.panes.find((p) => p.key === b)!.openedBy).toBe(a)
    const back = ws.reopenClosed()!
    const opener = back.keys[0]!
    expect(ws.panes.find((p) => p.key === b)!.openedBy).toBe(opener)
    ws.update(opener, { terminalId: 'ta2' })
    await nextTick()
    expect(peers.list.map((l) => l.id)).toEqual([openedLinkId('ta2', 'tb')])
    expect(peers.pulses).toHaveLength(pulses)

    ws.requestClose([b], () => false)
    const again = ws.reopenClosed()!
    expect(ws.panes.find((p) => p.key === again.keys[0])!.openedBy).toBe(opener)
  })
})
