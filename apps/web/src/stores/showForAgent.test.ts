import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AGENT_VIEWERS_MAX, useWorkspaceStore } from './workspace'

describe('showForAgent (open_in_workspace)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  function caller() {
    const ws = useWorkspaceStore()
    const pane = ws.open('claude', 'C:\\repo')
    ws.update(pane.key, { sessionId: 'pty-1' })
    return { ws, pane }
  }

  it('re-checks the path is inside the caller folder (or the host real root) and does not move focus', () => {
    const { ws, pane } = caller()
    expect(ws.showForAgent('pty-1', { path: 'C:\\other\\x.ts', diff: false })).toBe('caller')
    expect(ws.showForAgent('nobody', { path: 'C:\\repo\\a.ts', diff: false })).toBe('caller')
    expect(ws.showForAgent('pty-1', { path: 'D:\\real\\repo\\a.ts', diff: false, root: 'D:\\real\\repo' })).toMatchObject({ reused: false })
    expect(ws.activeKey).toBe(pane.key)
  })

  it('keeps one viewer per agent and refuses past the cap of viewers with unsaved edits', () => {
    const { ws } = caller()
    const first = ws.showForAgent('pty-1', { path: 'C:\\repo\\a.ts', line: 2, diff: false })
    const second = ws.showForAgent('pty-1', { path: 'C:\\repo\\b.ts', line: 5, diff: false })
    expect(typeof first === 'object' && typeof second === 'object' && second.paneKey === first.paneKey && second.reused).toBe(true)
    expect(ws.panes.filter((p) => p.kind === 'file')).toHaveLength(1)
    expect(ws.panes.find((p) => p.kind === 'file')).toMatchObject({ path: 'C:\\repo\\b.ts', line: 5 })
    for (let i = 1; i < AGENT_VIEWERS_MAX; i++) {
      for (const p of ws.panes) if (p.kind === 'file') ws.setDirty(p.key, true)
      expect(ws.showForAgent('pty-1', { path: `C:\\repo\\n${i}.ts`, diff: false })).toMatchObject({ reused: false })
    }
    for (const p of ws.panes) if (p.kind === 'file') ws.setDirty(p.key, true)
    expect(ws.panes.filter((p) => p.kind === 'file')).toHaveLength(AGENT_VIEWERS_MAX)
    expect(ws.showForAgent('pty-1', { path: 'C:\\repo\\z.ts', diff: false })).toBe('limit')
  })
})
