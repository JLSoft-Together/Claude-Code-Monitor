import { describe, expect, it } from 'vitest'
import { findAction, isSeparator, type MenuEntry } from '../menu'
import { emptyMenu, isMenuKey, projectMenu, rowMenu, type ProjectMenuCtx, type RowMenuCtx } from './railMenu'

const t = (k: string) => k.split('.').pop()!
const ids = (e: MenuEntry[]) => e.map((x) => (isSeparator(x) ? '-' : x.id))
const kids = (e: MenuEntry[], id: string) => ids(findAction(e, id)?.children ?? [])

const project = (p: Partial<ProjectMenuCtx> = {}): ProjectMenuCtx => ({
  mac: false, dir: 'C:\\r\\alpha', home: false, live: true, anchored: true,
  viewers: { file: true, changes: true, log: true }, scripts: true, run: true,
  layouts: [], explorer: true, reveal: true, canUp: true, canDown: true, collapsed: false, ...p,
})
const row = (p: Partial<RowMenuCtx> = {}): RowMenuCtx => ({ tabRow: false, cwd: 'C:\\r\\alpha', explorer: true, agent: true, linked: true, others: 1, ...p })

describe('projectMenu', () => {
  it('lists the project actions in order', () => {
    expect(ids(projectMenu(project(), t))).toEqual([
      'new', 'run', 'scripts', 'layouts', '-', 'explorer', 'mission', 'copy-path', 'reveal', '-', 'move-up', 'move-down', 'toggle', '-', 'close-project',
    ])
  })
  it('new tab offers agents, browser and the viewers that exist', () => {
    const m = projectMenu(project(), t)
    expect(kids(m, 'new')).toEqual(['new:claude', 'new:codex', 'new:shell', 'new:browser', 'new:file', 'new:changes', 'new:log'])
    expect(kids(projectMenu(project({ viewers: { file: false, changes: false, log: false } }), t), 'new')).toEqual(['new:claude', 'new:codex', 'new:shell', 'new:browser'])
  })
  it('layouts: save always, manage + saved ones when any', () => {
    expect(kids(projectMenu(project(), t), 'layouts')).toEqual(['layout-save'])
    const m = projectMenu(project({ layouts: [{ id: 'a', name: 'A', openOnStart: true }] }), t)
    expect(kids(m, 'layouts')).toEqual(['layout-save', 'layout-manage', '-', 'layout:a'])
    expect(findAction(m, 'layout:a')?.hint).toBe('onStart')
    expect(ids(projectMenu(project({ layouts: null }), t))).not.toContain('layouts')
  })
  it('hides missing bridges and gates Run on detection', () => {
    const m = ids(projectMenu(project({ run: false, scripts: false, reveal: false, explorer: false }), t))
    expect(m).not.toContain('run')
    expect(m).not.toContain('scripts')
    expect(m).not.toContain('reveal')
    expect(m).not.toContain('explorer')
  })
  it('disables what cannot apply, with a reason', () => {
    const m = projectMenu(project({ anchored: false, canUp: false, canDown: false }), t)
    expect(findAction(m, 'explorer')).toMatchObject({ disabled: true, hint: 'noPane' })
    expect(findAction(m, 'move-up')?.disabled).toBe(true)
    expect(findAction(m, 'move-down')?.disabled).toBe(true)
  })
  it('remembered project: Remove from list instead of Close, no Mission Control', () => {
    const m = projectMenu(project({ live: false, anchored: false }), t)
    expect(ids(m)).toContain('forget')
    expect(ids(m)).not.toContain('close-project')
    expect(findAction(m, 'mission')?.disabled).toBe(true)
  })
  it('home cluster: new tab only, path actions disabled', () => {
    const m = projectMenu(project({ dir: null, home: true }), t)
    expect(kids(m, 'new')).not.toContain('new:changes')
    expect(ids(m)).not.toContain('run')
    expect(findAction(m, 'copy-path')?.disabled).toBe(true)
    expect(findAction(m, 'reveal')?.disabled).toBe(true)
  })
  it('collapse toggles its label; shortcuts follow the platform', () => {
    expect(findAction(projectMenu(project({ collapsed: true }), t), 'toggle')?.label).toBe('expand')
    expect(findAction(projectMenu(project(), t), 'toggle')?.label).toBe('collapse')
    expect(findAction(projectMenu(project({ mac: true }), t), 'move-up')?.shortcut).toBe('⌥↑')
    expect(findAction(projectMenu(project({ mac: true }), t), 'reveal')?.label).toBe('finder')
    expect(findAction(projectMenu(project(), t), 'reveal')?.label).toBe('fileManager')
  })
})

describe('rowMenu', () => {
  it('lists the row actions with split presets', () => {
    const m = rowMenu(row(), t)
    expect(ids(m)).toEqual(['focus', '-', 'split-right', 'split-down', '-', 'copy-cwd', 'explorer', 'monitor', '-', 'close', 'close-others'])
    expect(kids(m, 'split-right')).toEqual(['split:row:claude', 'split:row:codex', 'split:row:shell', 'split:row:browser'])
    expect(kids(m, 'split-down')[0]).toBe('split:col:claude')
  })
  it('Show in Monitor only for agent rows, disabled until linked', () => {
    expect(ids(rowMenu(row({ agent: false }), t))).not.toContain('monitor')
    expect(findAction(rowMenu(row({ linked: false }), t), 'monitor')).toMatchObject({ disabled: true, hint: 'notLinked' })
  })
  it('tab rows close the tab; Close others needs other panes', () => {
    const tab = rowMenu(row({ tabRow: true }), t)
    expect(findAction(tab, 'close')?.label).toBe('closeTab')
    expect(findAction(tab, 'close-others')?.disabled).toBe(true)
    expect(findAction(rowMenu(row({ others: 0 }), t), 'close-others')?.disabled).toBe(true)
    expect(findAction(rowMenu(row(), t), 'close-others')?.disabled).toBeFalsy()
  })
  it('no cwd: copy and Explorer disabled', () => {
    const m = rowMenu(row({ cwd: null }), t)
    expect(findAction(m, 'copy-cwd')?.disabled).toBe(true)
    expect(findAction(m, 'explorer')?.disabled).toBe(true)
  })
})

describe('emptyMenu / isMenuKey', () => {
  it('offers Open Project and collapse / expand all', () => {
    expect(ids(emptyMenu({ open: true, any: true }, t))).toEqual(['open-project', '-', 'collapse-all', 'expand-all'])
    expect(ids(emptyMenu({ open: false, any: true }, t))).toEqual(['collapse-all', 'expand-all'])
    expect(emptyMenu({ open: false, any: false }, t)).toEqual([])
  })
  it('ContextMenu key and Shift+F10 open the menu', () => {
    const k = (key: string, mods: Partial<KeyboardEvent> = {}) => isMenuKey({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods })
    expect(k('ContextMenu')).toBe(true)
    expect(k('F10', { shiftKey: true })).toBe(true)
    expect(k('F10')).toBe(false)
    expect(k('F10', { shiftKey: true, ctrlKey: true })).toBe(false)
  })
})
