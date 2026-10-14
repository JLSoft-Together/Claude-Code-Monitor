import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import en from '../i18n/en'
import vi from '../i18n/vi'
import { leaves } from '../lib/splitLayout'
import { primaryPaneKey, useWorkspaceStore, workCwd } from './workspace'

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
