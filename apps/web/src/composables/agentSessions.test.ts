import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PtyPreset } from '@ccm/shared'

describe('agent session tools (list_sessions / send_to_session / close_session)', () => {
  let ws: Awaited<ReturnType<typeof boot>>['ws']
  let act: Awaited<ReturnType<typeof boot>>['act']

  async function boot() {
    vi.resetModules()
    setActivePinia(createPinia())
    ;(window as unknown as { ccmDesktop: unknown }).ccmDesktop = { platform: 'win32', onOrrery: () => undefined }
    const store = await import('../stores/workspace')
    const actions = await import('./useSessionActions')
    return { ws: store.useWorkspaceStore(), act: actions.useSessionActions() }
  }

  function pane(preset: PtyPreset, cwd: string, id: string, openedBy?: string) {
    const p = ws.open(preset, cwd)
    ws.update(p.key, { sessionId: `pty-${id}`, state: 'running', ...(openedBy ? { openedBy } : {}) })
    return ws.panes.find((x) => x.key === p.key)!
  }

  const never = () => false
  const busyWhenAgent = (p: { preset: string }) => p.preset !== 'shell'

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    ;({ ws, act } = await boot())
  })

  describe('listFor', () => {
    it('lists only the caller project, marks self and the panes it opened', () => {
      const lead = pane('claude', 'C:\\work\\A', 'lead')
      const kid = pane('codex', 'C:\\work\\A', 'kid', lead.key)
      pane('shell', 'C:\\work\\A', 'sh')
      pane('claude', 'C:\\work\\B', 'other')
      const list = act.listFor('pty-lead')
      expect(Array.isArray(list)).toBe(true)
      const rows = list as Exclude<typeof list, string>
      expect(rows.map((r) => r.sessionId).sort()).toEqual(['pty-kid', 'pty-lead', 'pty-sh'])
      expect(rows.find((r) => r.sessionId === 'pty-lead')).toMatchObject({ self: true, openedByYou: false, agent: 'claude' })
      expect(rows.find((r) => r.sessionId === 'pty-kid')).toMatchObject({ self: false, openedByYou: true, agent: 'codex' })
      expect(kid.key).toBeTruthy()
    })

    it('adds the agent uuid next to the pane id once the pane has one', () => {
      const lead = pane('claude', 'C:\\work\\A', 'lead')
      const uuid = '1c4e8b0f-2222-4333-8444-555566667777'
      ws.update(lead.key, { agentSessionId: uuid })
      pane('shell', 'C:\\work\\A', 'sh')
      const rows = act.listFor('pty-lead') as Exclude<ReturnType<typeof act.listFor>, string>
      expect(rows.find((r) => r.sessionId === 'pty-lead')!.agentSessionId).toBe(uuid)
      expect(rows.find((r) => r.sessionId === 'pty-sh')!.agentSessionId).toBeUndefined()
    })

    it('says caller for an unknown or closed pane and skips panes that are not running', () => {
      expect(act.listFor('pty-nope')).toBe('caller')
      pane('claude', 'C:\\work\\A', 'lead')
      const gone = pane('claude', 'C:\\work\\A', 'gone')
      ws.update(gone.key, { state: 'exited' })
      expect((act.listFor('pty-lead') as { sessionId: string }[]).map((r) => r.sessionId)).toEqual(['pty-lead'])
    })
  })

  describe('typeInto', () => {
    it('prefills the other agent without submitting', () => {
      pane('claude', 'C:\\work\\A', 'lead')
      const kid = pane('codex', 'C:\\work\\A', 'kid')
      const out = act.typeInto('pty-lead', 'pty-kid', 'run the tests')
      expect(out).toMatchObject({ name: expect.any(String) })
      const now = ws.panes.find((p) => p.key === kid.key)!
      expect(now.prefill).toBe('run the tests')
      expect(now.prefillSubmit).toBeFalsy()
    })

    it('refuses itself, another project, a shell, an unknown or closed target and an unknown caller', () => {
      const lead = pane('claude', 'C:\\work\\A', 'lead')
      pane('claude', 'C:\\work\\B', 'other')
      pane('shell', 'C:\\work\\A', 'sh')
      const dead = pane('codex', 'C:\\work\\A', 'dead')
      ws.update(dead.key, { state: 'exited' })
      for (const id of ['pty-lead', 'pty-other', 'pty-sh', 'pty-dead', 'pty-zz']) expect(act.typeInto('pty-lead', id, 'x'), id).toBe('target')
      expect(act.typeInto('pty-zz', 'pty-lead', 'x')).toBe('caller')
      expect(ws.panes.find((p) => p.key === lead.key)!.prefill).toBeUndefined()
      expect(ws.panes.some((p) => p.prefill)).toBe(false)
    })

    it('keeps a pending prompt: busy instead of overwriting', () => {
      pane('claude', 'C:\\work\\A', 'lead')
      const kid = pane('codex', 'C:\\work\\A', 'kid')
      ws.update(kid.key, { prefill: 'owner typed this' })
      expect(act.typeInto('pty-lead', 'pty-kid', 'x')).toBe('busy')
      expect(ws.panes.find((p) => p.key === kid.key)!.prefill).toBe('owner typed this')
    })
  })

  describe('closeOpened', () => {
    it('closes only a pane the caller opened, and the owner can reopen it', () => {
      const lead = pane('claude', 'C:\\work\\A', 'lead')
      const kid = pane('shell', 'C:\\work\\A', 'kid', lead.key)
      expect(act.closeOpened('pty-lead', 'pty-kid', never as never)).toMatchObject({ confirm: false })
      expect(ws.panes.some((p) => p.key === kid.key)).toBe(false)
      expect(ws.closedStack.length).toBe(1)
      ws.reopenClosed()
      expect(ws.panes.some((p) => p.sessionId === 'pty-kid' || p.cwd === 'C:\\work\\A')).toBe(true)
    })

    it('refuses panes it did not open, itself, and unknown ids', () => {
      const lead = pane('claude', 'C:\\work\\A', 'lead')
      const mine = pane('shell', 'C:\\work\\A', 'mine', lead.key)
      const theirs = pane('shell', 'C:\\work\\A', 'theirs')
      expect(act.closeOpened('pty-lead', 'pty-theirs', never as never)).toBe('target')
      expect(act.closeOpened('pty-lead', 'pty-lead', never as never)).toBe('target')
      expect(act.closeOpened('pty-lead', 'pty-zz', never as never)).toBe('target')
      expect(act.closeOpened('pty-zz', 'pty-mine', never as never)).toBe('caller')
      expect(ws.panes.some((p) => p.key === theirs.key)).toBe(true)
      expect(ws.panes.some((p) => p.key === mine.key)).toBe(true)
    })

    it('a pane that runs something waits for the owner, and a second close while the sheet is open is busy', () => {
      const lead = pane('claude', 'C:\\work\\A', 'lead')
      const kid = pane('codex', 'C:\\work\\A', 'kid', lead.key)
      pane('codex', 'C:\\work\\A', 'kid2', lead.key)
      expect(act.closeOpened('pty-lead', 'pty-kid', busyWhenAgent as never)).toMatchObject({ confirm: true })
      expect(ws.pendingClose).toEqual([kid.key])
      expect(ws.panes.some((p) => p.key === kid.key)).toBe(true)
      expect(act.closeOpened('pty-lead', 'pty-kid2', busyWhenAgent as never)).toBe('busy')
    })
  })
})
