import { describe, expect, it } from 'vitest'
import { findAction, isSeparator, type MenuAction, type MenuEntry } from './menu'
import { moveTargetOf, tabMenu, type TabMenuCtx } from './tabMenu'

const t = (key: string): string => key
const ids = (entries: MenuEntry[]): string[] => entries.map((e) => (isSeparator(e) ? '-' : e.id))
const ctx = (over: Partial<TabMenuCtx> = {}): TabMenuCtx => ({ active: false, panes: 1, targets: [], others: 0, ...over })

describe('tabMenu', () => {
  it('offers Open only for a tab that is not active', () => {
    expect(ids(tabMenu(ctx(), t))[0]).toBe('open')
    expect(ids(tabMenu(ctx({ active: true }), t))).not.toContain('open')
  })

  it('lists rename with F2, then close actions after a separator', () => {
    const entries = tabMenu(ctx({ active: true }), t)
    expect(ids(entries)).toEqual(['rename', 'move', '-', 'close', 'close-others'])
    expect(findAction(entries, 'rename')).toMatchObject({ label: 'workspace.tabActions.rename', shortcut: 'F2' })
  })

  it('separates panes only when the tab holds several', () => {
    expect(ids(tabMenu(ctx({ panes: 1 }), t))).not.toContain('ungroup')
    expect(ids(tabMenu(ctx({ panes: 3 }), t))).toContain('ungroup')
  })

  it('moves into other tabs of the project through a submenu', () => {
    const entries = tabMenu(ctx({ targets: [{ key: 't2', name: 'api' }, { key: 't3', name: 'web' }], others: 2 }), t)
    const move = findAction(entries, 'move') as MenuAction
    expect(move.disabled).toBeFalsy()
    expect(move.children?.map((c) => (isSeparator(c) ? '-' : [c.id, c.label]))).toEqual([
      ['move:t2', 'api'],
      ['move:t3', 'web'],
    ])
    expect(findAction(entries, 'close-others')?.disabled).toBe(false)
  })

  it('disables move and close others without other tabs, explaining why', () => {
    const entries = tabMenu(ctx(), t)
    expect(findAction(entries, 'move')).toMatchObject({ disabled: true, hint: 'workspace.tabActions.noTargets' })
    expect(findAction(entries, 'move')?.children).toBeUndefined()
    expect(findAction(entries, 'close-others')?.disabled).toBe(true)
  })

  it('reads the target tab back from a move id', () => {
    expect(moveTargetOf('move:t9')).toBe('t9')
    expect(moveTargetOf('move:')).toBeNull()
    expect(moveTargetOf('close')).toBeNull()
  })
})

describe('tabMenu zoom and dim', () => {
  it('offers zoom with its keys for a split tab, unzoom while zoomed, nothing for one pane', () => {
    expect(ids(tabMenu(ctx({ panes: 1, dim: false }), t))).not.toContain('zoom')
    expect(ids(tabMenu(ctx({ panes: 1, dim: false }), t))).not.toContain('dim')
    const entries = tabMenu(ctx({ active: true, panes: 2, zoomKeys: 'Ctrl+Shift+Enter' }), t)
    expect(ids(entries)).toEqual(['rename', 'ungroup', 'move', '-', 'zoom', '-', 'close', 'close-others'])
    expect(findAction(entries, 'zoom')).toMatchObject({ label: 'workspace.zoom.zoom', shortcut: 'Ctrl+Shift+Enter' })
    expect(findAction(tabMenu(ctx({ panes: 2, zoomed: true }), t), 'unzoom')).toMatchObject({ label: 'workspace.zoom.unzoom' })
    expect(ids(tabMenu(ctx({ panes: 2, zoomed: true }), t))).not.toContain('zoom')
  })

  it('names the dim toggle by what it will do', () => {
    expect(findAction(tabMenu(ctx({ panes: 2, dim: false }), t), 'dim')).toMatchObject({ label: 'workspace.dim.menu' })
    expect(findAction(tabMenu(ctx({ panes: 3, dim: true }), t), 'dim')).toMatchObject({ label: 'workspace.dim.toggleOn' })
  })
})

describe('tabMenu compact', () => {
  it('offers Compact for the tab agent, or its cancel while a handoff runs', () => {
    expect(ids(tabMenu(ctx({ compact: 'ready' }), t))).toContain('compact')
    expect(ids(tabMenu(ctx({ compact: 'running' }), t))).toContain('compact-cancel')
    expect(ids(tabMenu(ctx(), t))).not.toContain('compact')
  })
})
