import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { TerminalSession } from '@ccm/shared'

vi.mock('../lib/ptyClient', () => ({ PtyConnection: { request: vi.fn(async () => undefined) } }))

describe('useWorkspaceLinks: what counts as a turn', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
    ;(window as unknown as { ccmDesktop: unknown }).ccmDesktop = { platform: 'win32', onOrrery: () => undefined }
  })

  async function setup() {
    const { useWorkspaceStore } = await import('../stores/workspace')
    const { useTerminalsStore } = await import('../stores/terminals')
    const { useWorkspaceLinks } = await import('./useWorkspaceLinks')
    const ws = useWorkspaceStore()
    const terminals = useTerminalsStore()
    mount(defineComponent({ setup: () => (useWorkspaceLinks(() => true), () => null) }))
    const opened = ws.openSession({ preset: 'claude', cwd: 'C:/work/app' }, { source: 'menu' })
    const pane = ws.panes.find((p) => opened.ok && p.key === opened.paneKey)!
    const id = pane.agentSessionId!
    ws.update(pane.key, { sessionId: 'host-a', state: 'running' })
    const term = (status: string) => ({ id: 't1', status, claudeSessionId: id, title: 'x', processId: 1 }) as unknown as TerminalSession
    return { ws, terminals, pane, term }
  }

  it('a waiting dialog keeps the minted id, a working turn drops it', async () => {
    const { ws, terminals, pane, term } = await setup()
    terminals.upsert(term('waiting'))
    ws.update(pane.key, { terminalId: 't1' })
    await nextTick()
    await nextTick()
    expect(ws.panes.find((p) => p.key === pane.key)!.mintedSession).toBe(pane.agentSessionId)
    terminals.upsert(term('working'))
    await nextTick()
    await nextTick()
    expect(ws.panes.find((p) => p.key === pane.key)!.mintedSession).toBeUndefined()
  })
})
