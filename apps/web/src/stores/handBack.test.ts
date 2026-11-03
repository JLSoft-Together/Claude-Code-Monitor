import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PtyPreset } from '@ccm/shared'
import { useWorkspaceStore } from './workspace'

vi.mock('../lib/desktop', async (original) => ({ ...(await original<typeof import('../lib/desktop')>()), hasDeepSeek: true }))

describe('handBack (hand_back)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  function setup(originPreset: PtyPreset = 'claude') {
    const ws = useWorkspaceStore()
    const origin = ws.open(originPreset, 'C:\\repo')
    ws.update(origin.key, { sessionId: 'pty-origin', state: 'running' })
    const opened = ws.openFromAgent({ id: 't1', preset: 'deepseek', cwd: 'C:\\repo', from: 'pty-origin', prompt: 'write tests' })
    if (!opened.ok) throw new Error('open failed')
    ws.update(opened.paneKey, { sessionId: 'pty-ds', state: 'running' })
    return { ws, origin: ws.panes.find((p) => p.key === origin.key)!, ds: ws.panes.find((p) => p.key === opened.paneKey)! }
  }

  it('queues a submitting prefill on the pane that opened the DeepSeek pane', () => {
    const { ws, origin, ds } = setup()
    expect(ds.openedBy).toBe(origin.key)
    const out = ws.handBack('pty-ds', 'Read the report')
    expect(out).toBe(origin)
    expect(origin).toMatchObject({ prefill: 'Read the report', prefillSubmit: true })
  })

  it('works for a Codex origin too', () => {
    const { ws, origin } = setup('codex')
    expect(ws.handBack('pty-ds', 'x')).toBe(origin)
  })

  it('refuses an unknown caller, a non-DeepSeek caller or one nobody opened', () => {
    const { ws } = setup()
    expect(ws.handBack('nobody', 'x')).toBe('caller')
    expect(ws.handBack('pty-origin', 'x')).toBe('caller')
    const lone = ws.open('deepseek', 'C:\\repo')
    ws.update(lone.key, { sessionId: 'pty-lone', state: 'running' })
    expect(ws.handBack('pty-lone', 'x')).toBe('caller')
  })

  it('refuses when the origin pane is closed or no longer running', () => {
    const { ws, origin } = setup()
    ws.update(origin.key, { state: 'exited' })
    expect(ws.handBack('pty-ds', 'x')).toBe('caller')
    ws.remove(origin.key)
    expect(ws.handBack('pty-ds', 'x')).toBe('caller')
  })

  it('refuses a shell origin, or an agent pane whose agent quit back to its shell', () => {
    const shell = setup('shell')
    expect(shell.ws.handBack('pty-ds', 'x')).toBe('caller')
    setActivePinia(createPinia())
    sessionStorage.clear()
    const quit = setup('claude')
    quit.ws.update(quit.origin.key, { agent: 'shell' })
    expect(quit.ws.handBack('pty-ds', 'x')).toBe('caller')
  })

  it('refuses while the origin already has a pending prefill or a Compact flow', () => {
    const { ws, origin } = setup()
    expect(ws.handBack('pty-ds', 'first')).toBe(origin)
    expect(ws.handBack('pty-ds', 'second')).toBe('limit')
    expect(origin.prefill).toBe('first')
    ws.update(origin.key, { prefill: undefined, prefillSubmit: undefined, compact: { step: 'writing', file: 'C:\\repo\\h.md', base: 0, worked: false } })
    expect(ws.handBack('pty-ds', 'x')).toBe('limit')
  })
})
