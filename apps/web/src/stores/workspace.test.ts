import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import en from '../i18n/en'
import vi from '../i18n/vi'
import { boxes, leaves } from '../lib/splitLayout'
import { primaryPaneKey, tabProject, useWorkspaceStore, workCwd } from './workspace'

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
})

describe('explorer preview viewer', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('a single click reuses one preview viewer in place; a double click keeps it', () => {
    const ws = useWorkspaceStore()
    const a = ws.openFile('C:\repo\a.ts', undefined, { preview: true })
    const b = ws.openFile('C:\repo\b.ts', undefined, { preview: true })
    expect(b.key).toBe(a.key)
    expect(b.path).toBe('C:\repo\b.ts')
    expect(ws.tabs).toHaveLength(1)
    ws.openFile('C:\repo\b.ts', undefined, { preview: false })
    expect(b.preview).toBeUndefined()
    const c = ws.openFile('C:\repo\c.ts', undefined, { preview: true })
    expect(c.key).not.toBe(b.key)
    expect(ws.tabs).toHaveLength(2)
    expect(ws.openFile('C:\repo\b.ts', 3, { preview: true }).key).toBe(b.key)
    expect(b.preview).toBeUndefined()
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

  it('keeps one Explorer preview slot per project', () => {
    const ws = useWorkspaceStore()
    const a = ws.openFile('C:/a/x.ts', undefined, { cwd: 'C:/a', preview: true })
    const b = ws.openFile('C:/b/y.ts', undefined, { cwd: 'C:/b', preview: true })
    expect(b.key).not.toBe(a.key)
    expect(ws.openFile('C:/a/z.ts', undefined, { cwd: 'C:/a', preview: true }).key).toBe(a.key)
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
