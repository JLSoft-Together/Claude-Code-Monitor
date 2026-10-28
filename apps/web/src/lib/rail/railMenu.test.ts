import { describe, expect, it } from 'vitest'
import { findAction, isSeparator, type MenuEntry } from '../menu'
import { emptyMenu, groupMenu, isMenuKey, projectMenu, rowMenu, type ProjectMenuCtx, type RowMenuCtx } from './railMenu'

const t = (k: string) => k.split('.').pop()!
const ids = (e: MenuEntry[]) => e.map((x) => (isSeparator(x) ? '-' : x.id))
const kids = (e: MenuEntry[], id: string) => ids(findAction(e, id)?.children ?? [])

const project = (p: Partial<ProjectMenuCtx> = {}): ProjectMenuCtx => ({
  mac: false, dir: 'C:\\r\\alpha', home: false, live: true, anchored: true,
  viewers: { file: true, changes: true, log: true }, scripts: true, run: true,
  layouts: [], explorer: true, env: true, reveal: true, canUp: true, canDown: true, collapsed: false, ...p,
})
const row = (p: Partial<RowMenuCtx> = {}): RowMenuCtx => ({
  tabRow: false, cwd: 'C:\\r\\alpha', explorer: true, agent: true, linked: true, others: 1, targets: [{ key: 't2', title: 'Review' }], ...p,
})

describe('projectMenu', () => {
  it('lists the project actions in order', () => {
    expect(ids(projectMenu(project(), t))).toEqual([
      'new', 'run', 'scripts', 'plan', 'env', 'layouts', '-', 'explorer', 'mission', 'copy-path', 'reveal', '-', 'move-up', 'move-down', 'toggle', '-', 'close-project',
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
    const m = ids(projectMenu(project({ run: false, scripts: false, reveal: false, explorer: false, env: false }), t))
    expect(m).not.toContain('run')
    expect(m).not.toContain('scripts')
    expect(m).not.toContain('reveal')
    expect(m).not.toContain('explorer')
    expect(m).not.toContain('plan')
    expect(m).not.toContain('env')
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
    expect(ids(m)).toEqual([
      'focus', '-', 'split-right', 'split-down', '-', 'rename-tab', 'move-to', 'move-out', '-', 'copy-cwd', 'explorer', 'monitor', '-', 'close', 'close-others',
    ])
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
  it('moves a pane to another tab of the project, or out to a tab of its own', () => {
    const m = rowMenu(row({ targets: [{ key: 't2', title: 'Review' }, { key: 't3', title: 'Shell' }] }), t)
    expect(kids(m, 'move-to')).toEqual(['move-to:t2', 'move-to:t3'])
    expect(findAction(m, 'move-to:t2')?.label).toBe('Review')
    expect(findAction(m, 'move-out')?.disabled).toBeFalsy()
    expect(findAction(m, 'rename-tab')).toMatchObject({ label: 'renameTab', shortcut: 'F2' })
  })
  it('no other tab: Move to tab disabled with a reason; a lone pane cannot move out', () => {
    const m = rowMenu(row({ targets: [], others: 0 }), t)
    expect(findAction(m, 'move-to')).toMatchObject({ disabled: true, hint: 'noTargets' })
    expect(findAction(m, 'move-to')?.children).toBeUndefined()
    expect(findAction(m, 'move-out')?.disabled).toBe(true)
    expect(findAction(rowMenu(row({ tabRow: true, others: 2 }), t), 'move-out')?.disabled).toBe(true)
  })
  it('no cwd: copy and Explorer disabled', () => {
    const m = rowMenu(row({ cwd: null }), t)
    expect(findAction(m, 'copy-cwd')?.disabled).toBe(true)
    expect(findAction(m, 'explorer')?.disabled).toBe(true)
  })
})

describe('groupMenu', () => {
  it('lists open, rename, fold, ungroup, then close', () => {
    expect(ids(groupMenu({ folded: false }, t))).toEqual(['open', 'rename', 'fold', 'ungroup', '-', 'close'])
    expect(ids(groupMenu({ folded: true }, t))).toEqual(['open', 'rename', 'unfold', 'ungroup', '-', 'close'])
  })
  it('labels come from the shared tab actions', () => {
    const m = groupMenu({ folded: true }, t)
    expect(findAction(m, 'unfold')).toMatchObject({ label: 'unfold', shortcut: '→' })
    expect(findAction(m, 'rename')).toMatchObject({ label: 'rename', shortcut: 'F2' })
    expect(findAction(m, 'close')?.label).toBe('close')
    expect(findAction(groupMenu({ folded: false }, t), 'fold')?.shortcut).toBe('←')
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

describe('row menu compact', () => {
  it('adds Compact before the close actions for agent rows, disabled with a reason when busy', () => {
    const ready = rowMenu(row({ compact: 'ready' }), t)
    expect(ids(ready).slice(-5)).toEqual(['-', 'compact', '-', 'close', 'close-others'])
    expect(findAction(rowMenu(row({ compact: 'busy' }), t), 'compact')).toMatchObject({ disabled: true, hint: 'busy' })
    expect(ids(rowMenu(row({ compact: 'running' }), t))).toContain('compact-cancel')
    expect(ids(rowMenu(row(), t))).not.toContain('compact')
  })
})
