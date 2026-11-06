import { describe, expect, it, vi } from 'vitest'
import type { Pane } from '../stores/workspace'
import { paneActionOf, runPaneAction, telegramLinkCtx, telegramMenuState, type PaneActionDeps } from './paneActions'

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e'
const agent = { key: 'p1', kind: 'term', preset: 'claude', cwd: 'C:\\work\\A', liveCwd: 'C:\\work\\A\\app', terminalId: 't1', agentSessionId: SESSION.toUpperCase() } as unknown as Pane

function deps(): PaneActionDeps & Record<string, ReturnType<typeof vi.fn>> {
  return { compact: vi.fn(), compactCancel: vi.fn(), telegramLink: vi.fn(), focus: vi.fn(), monitor: vi.fn() }
}

describe('paneActions', () => {
  it('knows the shared ids and the rail alias, and leaves the rest to the menu', () => {
    expect(paneActionOf('rename-tab')).toBe('rename')
    expect(paneActionOf('close-others')).toBe('close-others')
    expect(paneActionOf('zoom')).toBeNull()
    expect(runPaneAction('ungroup', { name: 'x' }, {}, deps())).toBe(false)
  })

  it('builds one ✈ dialog context for a pane with a Claude session', () => {
    expect(telegramLinkCtx(agent, 'App')).toEqual({ cwd: 'C:\\work\\A\\app', session: SESSION, name: 'App' })
    expect(telegramLinkCtx({ ...agent, agentSessionId: undefined } as Pane, 'App')).toBeNull()
    expect(telegramLinkCtx({ ...agent, kind: 'browser' } as Pane, 'App')).toBeNull()
    expect(telegramMenuState(agent, (s) => s === SESSION)).toBe('linked')
    expect(telegramMenuState(agent, () => false)).toBe('unlinked')
    expect(telegramMenuState(undefined, () => true)).toBeUndefined()
  })

  it('tab menu: runs compact, ✈, rename and close through the same actions', () => {
    const d = deps()
    const hooks = { rename: vi.fn(), close: vi.fn(), closeOthers: vi.fn() }
    const subject = { key: agent.key, pane: agent, name: 'Tab A' }
    for (const id of ['compact', 'compact-cancel', 'telegram-link', 'rename', 'close', 'close-others']) expect(runPaneAction(id, subject, hooks, d)).toBe(true)
    expect(d.compact).toHaveBeenCalledWith('p1')
    expect(d.compactCancel).toHaveBeenCalledWith('p1')
    expect(d.telegramLink).toHaveBeenCalledWith({ cwd: 'C:\\work\\A\\app', session: SESSION, name: 'Tab A' })
    expect(hooks.rename).toHaveBeenCalledOnce()
    expect(hooks.close).toHaveBeenCalledOnce()
    expect(hooks.closeOthers).toHaveBeenCalledOnce()
  })

  it('rail row menu: focus, monitor, copy-cwd and rename-tab, keyed by the row pane', () => {
    const d = deps()
    const hooks = { rename: vi.fn(), copy: vi.fn() }
    const subject = { key: 'focus-key', pane: agent, name: 'Row', cwd: 'C:\\work\\A\\app' }
    for (const id of ['focus', 'monitor', 'copy-cwd', 'rename-tab', 'compact']) runPaneAction(id, subject, hooks, d)
    expect(d.focus).toHaveBeenCalledWith('focus-key')
    expect(d.monitor).toHaveBeenCalledWith('t1')
    expect(d.compact).toHaveBeenCalledWith('focus-key')
    expect(hooks.copy).toHaveBeenCalledWith('C:\\work\\A\\app')
    expect(hooks.rename).toHaveBeenCalledOnce()
  })

  it('group menu and panes without a session do nothing for pane-only actions', () => {
    const d = deps()
    const close = vi.fn()
    expect(runPaneAction('telegram-link', { name: 'G' }, { close }, d)).toBe(true)
    expect(runPaneAction('monitor', { name: 'G' }, { close }, d)).toBe(true)
    expect(runPaneAction('copy-cwd', { name: 'G', cwd: null }, { close }, d)).toBe(true)
    expect(runPaneAction('close', { name: 'G' }, { close }, d)).toBe(true)
    expect(d.telegramLink).not.toHaveBeenCalled()
    expect(d.monitor).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
})
