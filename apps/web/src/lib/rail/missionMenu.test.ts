import { describe, expect, it } from 'vitest'
import { findAction, isSeparator, type MenuEntry } from '../menu'
import { cardMenu, menuPick, tileMenu } from './missionMenu'

const t = (k: string) => k.split('.').pop()!
const ids = (e: MenuEntry[]) => e.map((x) => (isSeparator(x) ? '-' : x.id))
const kids = (e: MenuEntry[], id: string) => ids(findAction(e, id)?.children ?? [])
const targets = [
  { key: 't2', title: 'Review' },
  { key: 't3', title: '' },
]

describe('mission card menu', () => {
  it('lists the tab actions in order', () => {
    expect(ids(cardMenu({ mac: false, panes: 2, targets }, t))).toEqual(['open', 'rename', 'ungroup', 'merge', '-', 'close'])
  })

  it('offers the other tabs of the project, by title or key', () => {
    const m = cardMenu({ mac: false, panes: 1, targets }, t)
    expect(kids(m, 'merge')).toEqual(['merge:t2', 'merge:t3'])
    expect(findAction(m, 'merge')?.children?.map((x) => (isSeparator(x) ? '-' : x.label))).toEqual(['Review', 't3'])
  })

  it('disables separating a single pane and moving with no other tab', () => {
    const m = cardMenu({ mac: false, panes: 1, targets: [] }, t)
    expect(findAction(m, 'ungroup')?.disabled).toBe(true)
    expect(findAction(m, 'merge')).toMatchObject({ disabled: true, hint: 'noTargets' })
    expect(findAction(m, 'merge')?.children).toBeUndefined()
  })

  it('shows Enter / ↩ and F2', () => {
    expect(findAction(cardMenu({ mac: true, panes: 1, targets }, t), 'open')?.shortcut).toBe('↩')
    expect(findAction(cardMenu({ mac: false, panes: 1, targets }, t), 'open')?.shortcut).toBe('Enter')
    expect(findAction(cardMenu({ mac: false, panes: 1, targets }, t), 'rename')?.shortcut).toBe('F2')
  })
})

describe('mission pane menu', () => {
  it('lists the pane actions in order', () => {
    const m = tileMenu({ mac: false, alone: false, targets }, t)
    expect(ids(m)).toEqual(['focus', 'move', 'detach', '-', 'close-pane'])
    expect(kids(m, 'move')).toEqual(['move:t2', 'move:t3'])
    expect(findAction(m, 'detach')?.disabled).toBeFalsy()
  })

  it('a pane alone in its tab cannot get a tab of its own', () => {
    const m = tileMenu({ mac: false, alone: true, targets: [] }, t)
    expect(findAction(m, 'detach')?.disabled).toBe(true)
    expect(findAction(m, 'move')).toMatchObject({ disabled: true, hint: 'noTargets' })
  })
})

describe('menu ids', () => {
  it('splits an action from its target tab', () => {
    expect(menuPick('merge:t2')).toEqual({ action: 'merge', target: 't2' })
    expect(menuPick('move:tab:x')).toEqual({ action: 'move', target: 'tab:x' })
    expect(menuPick('close-pane')).toEqual({ action: 'close-pane', target: null })
  })
})

describe('mission tile compact', () => {
  it('offers Compact on agent tiles only', () => {
    expect(ids(tileMenu({ mac: false, alone: false, targets, compact: 'ready' }, t))).toEqual(['focus', 'move', 'detach', '-', 'compact', '-', 'close-pane'])
    expect(ids(tileMenu({ mac: false, alone: false, targets }, t))).not.toContain('compact')
  })
})
