import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TELEGRAM_INBOUND_ACTION, type PtyPreset, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'

type Handler = (raw: unknown) => TelegramInboundResult | Promise<TelegramInboundResult>

describe('session actions (resolveTarget + Telegram adapter)', () => {
  let handler: Handler
  let ws: Awaited<ReturnType<typeof boot>>['ws']
  let act: Awaited<ReturnType<typeof boot>>['act']
  const compactStart = vi.fn((_key: string) => true)

  async function boot() {
    vi.resetModules()
    setActivePinia(createPinia())
    ;(window as unknown as { ccmDesktop: unknown }).ccmDesktop = { platform: 'win32', onOrrery: () => undefined, telegramPanes: async () => true }
    vi.doMock('./useCompact', () => ({ useCompact: () => ({ start: compactStart }) }))
    const mod = await import('./useTelegramInbound')
    const orrery = await import('./useOrreryApi')
    // Same adapter as main: the bot's request goes through the Orrery executor under its action name.
    const captured: Handler = (raw) => orrery.runOrrery(TELEGRAM_INBOUND_ACTION[(raw as TelegramInbound).action], raw, { source: 'telegram' }) as Promise<TelegramInboundResult>
    const store = await import('../stores/workspace')
    const actions = await import('./useSessionActions')
    mod.installTelegramInbound()
    return { handler: captured, ws: store.useWorkspaceStore(), act: actions.useSessionActions() }
  }

  function pane(preset: PtyPreset, cwd: string, id: string) {
    const p = ws.open(preset, cwd)
    ws.update(p.key, { sessionId: `pty-${id}`, terminalId: `term-${id}`, state: 'running' })
    return ws.panes.find((x) => x.key === p.key)!
  }

  beforeEach(async () => {
    compactStart.mockReset().mockReturnValue(true)
    localStorage.clear()
    sessionStorage.clear()
    ;({ handler, ws, act } = await boot())
  })

  describe('resolveTarget', () => {
    it('picks the only agent pane, and says none / many otherwise', () => {
      expect(ws.resolveTarget({ project: 'C:\\work\\A' })).toBe('none')
      const a = pane('claude', 'C:\\work\\A', 'a')
      pane('shell', 'C:\\work\\A', 's')
      expect(ws.resolveTarget({ project: 'C:\\work\\A' })).toBe(a)
      pane('codex', 'C:\\work\\A\\sub', 'b')
      expect(ws.resolveTarget({ project: 'C:\\work\\A' })).toBe('many')
    })

    it('honours terminalId, sessionId and pane key, and says gone for a closed target', () => {
      const a = pane('claude', 'C:\\work\\A', 'a')
      const b = pane('codex', 'C:\\work\\A', 'b')
      expect(ws.resolveTarget({ project: 'C:\\work\\A', terminalId: 'term-b' })).toBe(b)
      expect(ws.resolveTarget({ project: 'C:\\work\\A', sessionId: 'pty-a' })).toBe(a)
      expect(ws.resolveTarget({ project: 'C:\\work\\A', pane: b.key })).toBe(b)
      expect(ws.resolveTarget({ project: 'C:\\work\\A', terminalId: 'term-zz' })).toBe('gone')
      expect(ws.resolveTarget({ project: 'C:\\work\\B', terminalId: 'term-a' })).toBe('gone')
    })

    it('leaves sub-project panes out when they have their own topic', () => {
      const a = pane('claude', 'C:\\repo', 'a')
      pane('claude', 'C:\\repo\\apps\\x', 'x')
      expect(ws.resolveTarget({ project: 'C:\\repo', nested: ['C:\\repo\\apps\\x'] })).toBe(a)
      expect(ws.resolveTarget({ project: 'C:\\repo', nested: ['C:\\repo\\apps\\x'], terminalId: 'term-x' })).toBe('gone')
    })
  })

  it('send returns the candidate panes on many and the pending pane on busy', () => {
    const a = pane('claude', 'C:\\work\\A', 'a')
    const b = pane('codex', 'C:\\work\\A', 'b')
    expect(act.send({ project: 'C:\\work\\A' }, 'x')).toEqual({ ok: false, error: 'many', panes: [a, b] })
    expect(act.send({ project: 'C:\\work\\A', terminalId: 'term-a' }, 'x')).toEqual({ ok: true, pane: a })
    expect(act.send({ project: 'C:\\work\\A', terminalId: 'term-a' }, 'y')).toEqual({ ok: false, error: 'busy', panes: [a] })
    expect(act.sendAll({ project: 'C:\\work\\A' }, 'z')).toEqual({ ok: true, panes: [b] })
    expect(act.sendAll({ project: 'C:\\work\\A' }, 'z')).toEqual({ ok: false, error: 'busy' })
    expect(act.sendAll({ project: 'C:\\work\\B' }, 'z')).toEqual({ ok: false, error: 'none' })
  })

  it('keys and stop refuse a pane that is not waiting on that prompt', async () => {
    pane('claude', 'C:\\work\\A', 'a')
    expect(await act.keys({ project: 'C:\\work\\A' }, { key: 'approve' })).toEqual({ ok: false, error: 'state' })
    expect(await act.stop({ project: 'C:\\work\\A' })).toEqual({ ok: false, error: 'state' })
    expect(await act.keys({ project: 'C:\\work\\A', terminalId: 'term-zz' }, { key: 'approve' })).toEqual({ ok: false, error: 'gone' })
  })

  it('paneInfo uses the auto title only when asked (Telegram yes, MCP no)', async () => {
    const { useTerminalsStore } = await import('../stores/terminals')
    const a = pane('claude', 'C:\\work\\A', 'a')
    useTerminalsStore().byId['term-a'] = { id: 'term-a', status: 'idle', title: 'Fix the parser' } as never
    expect(act.paneInfo(a).name).toBe('Fix the parser')
    expect(act.nameOf(a, { title: false })).toBe('A')
  })

  it('esc is ready for any waiting prompt of that episode and nothing else', async () => {
    const { keysReady } = await import('./useSessionActions')
    const at = '2026-11-04T10:00:00.000Z'
    const waiting = { status: 'waiting', statusSince: at, waitingFor: 'something else' } as never
    expect(keysReady({ key: 'esc', since: Date.parse(at) }, waiting, false)).toBe(true)
    expect(keysReady({ key: 'esc', since: Date.parse(at) + 1 }, waiting, true)).toBe(false)
    expect(keysReady({ key: 'esc', since: Date.parse(at) }, { status: 'working', statusSince: at } as never, true)).toBe(false)
    expect(keysReady({ key: 'esc' }, { status: 'idle' } as never, true)).toBe(false)
    expect(keysReady({ key: 'approve', since: Date.parse(at) }, waiting, true)).toBe(false)
  })

  describe('Telegram adapter', () => {
    it('compact starts the Compact flow on the one pane, and says busy / state otherwise', async () => {
      const a = pane('claude', 'C:\\work\\A', 'a')
      const ask = (extra: Record<string, unknown> = {}) => handler({ id: 'x', action: 'compact', project: 'C:\\work\\A', ...extra })
      expect(await ask()).toEqual({ ok: true, action: 'compact', name: 'A' })
      expect(compactStart).toHaveBeenCalledWith(a.key)
      compactStart.mockReturnValue(false)
      expect(await ask()).toEqual({ ok: false, error: 'state' })
      ws.update(a.key, { prefill: 'typed' })
      expect(await ask()).toMatchObject({ ok: false, error: 'busy', panes: [{ name: 'A' }] })
      expect(compactStart).toHaveBeenCalledTimes(2)
      expect(await ask({ target: { kind: 'terminal', terminalId: 'term-zz' } })).toEqual({ ok: false, error: 'gone' })
    })

    it('close and compact refuse a confirm whose pane moved on since it was shown', async () => {
      const { useTerminalsStore } = await import('../stores/terminals')
      const a = pane('claude', 'C:\\work\\A', 'a')
      const at = '2026-11-04T10:00:00.000Z'
      useTerminalsStore().byId['term-a'] = { id: 'term-a', status: 'idle', statusSince: at } as never
      const ask = (action: string, since: number) => handler({ id: 'x', action, project: 'C:\\work\\A', since })
      expect(await ask('compact', Date.parse(at) + 1)).toEqual({ ok: false, error: 'state' })
      expect(await ask('close', Date.parse(at) + 1)).toEqual({ ok: false, error: 'state' })
      expect(compactStart).not.toHaveBeenCalled()
      expect(ws.panes.some((p) => p.key === a.key)).toBe(true)
      expect(await ask('compact', Date.parse(at))).toMatchObject({ ok: true, action: 'compact' })
      expect(await ask('close', Date.parse(at))).toMatchObject({ ok: true, action: 'close' })
      expect(ws.panes.some((p) => p.key === a.key)).toBe(false)
    })

    it('close removes only the chosen pane (undoable), focus activates it', async () => {
      const a = pane('claude', 'C:\\work\\A', 'a')
      const b = pane('codex', 'C:\\work\\A', 'b')
      const ask = (action: string, extra: Record<string, unknown> = {}) => handler({ id: 'x', action, project: 'C:\\work\\A', ...extra })
      expect(await ask('close')).toMatchObject({ ok: false, error: 'many' })
      expect(await ask('focus')).toMatchObject({ ok: false, error: 'many' })
      expect(await ask('focus', { target: { kind: 'terminal', terminalId: 'term-b' } })).toMatchObject({ ok: true, action: 'focus' })
      expect(ws.activeKey).toBe(b.key)
      expect(await ask('close', { target: { kind: 'terminal', terminalId: 'term-a' } })).toEqual({ ok: true, action: 'close', name: 'A' })
      expect(ws.panes.some((p) => p.key === a.key)).toBe(false)
      expect(ws.panes.some((p) => p.key === b.key)).toBe(true)
      expect(ws.closedStack.length).toBeGreaterThan(0)
      expect(await ask('close', { target: { kind: 'terminal', terminalId: 'term-a' } })).toEqual({ ok: false, error: 'gone' })
    })

    const ask = (action: string, extra: Record<string, unknown> = {}) => handler({ id: 'x', action, project: 'C:\\work\\A', ...extra })

    it('maps many / busy / none to the reply with pane names', async () => {
      pane('claude', 'C:\\work\\A', 'a')
      pane('codex', 'C:\\work\\A\\b', 'b')
      expect(await ask('send', { text: 'hi', from: 'Owner' })).toMatchObject({ ok: false, error: 'many', panes: [{ name: 'A' }, { name: 'b' }] })
      expect(await ask('send', { text: 'hi', from: 'Owner', target: { kind: 'terminal', terminalId: 'term-a' } })).toMatchObject({ ok: true, action: 'send', name: 'A' })
      expect(await ask('send', { text: 'again', from: 'Owner', target: { kind: 'terminal', terminalId: 'term-a' } })).toMatchObject({ ok: false, error: 'busy', panes: [{ name: 'A' }] })
      expect(await ask('keys', { key: 'approve' })).toMatchObject({ ok: false, error: 'many', panes: [{ name: 'A' }, { name: 'b' }] })
      expect(await ask('keys', { key: 'approve', target: { kind: 'pane', sessionId: 'pty-zz' } })).toEqual({ ok: false, error: 'gone' })
      expect(await ask('status')).toMatchObject({ ok: true, action: 'status', panes: [{ name: 'A' }, { name: 'b' }] })
      expect(await ask('all', { text: 'go', from: 'Owner' })).toMatchObject({ ok: true, action: 'all', names: ['b'] })
      expect(await handler({ id: 'x', action: 'all', project: 'C:\\work\\Z', text: 'go', from: 'Owner' })).toEqual({ ok: false, error: 'none' })
    })
  })

  describe('images from Telegram', () => {
    const shot = (n: number) => `C:\\work\\A\\.orrery\\telegram\\2026-1-${n}-photo.jpg`
    const send = (extra: Record<string, unknown> = {}) => handler({ id: 'x', action: 'send', project: 'C:\\work\\A', text: 'paths', from: 'Owner', images: [shot(1), shot(2)], imageText: 'attached', ...extra })

    async function idle(preset: 'claude' | 'codex', status = 'idle') {
      const { useTerminalsStore } = await import('../stores/terminals')
      const { useAttachmentsStore } = await import('../stores/attachments')
      const a = pane(preset, 'C:\\work\\A', 'a')
      useTerminalsStore().byId['term-a'] = { id: 'term-a', status, statusSince: '2026-11-04T10:00:00.000Z' } as never
      return { a, store: useAttachmentsStore() }
    }
    const prefillOf = (key: string) => ws.panes.find((p) => p.key === key)?.prefill

    it('puts the images in the tray of an idle Claude pane and prefills only the caption prompt', async () => {
      const { a, store } = await idle('claude')
      expect(await send()).toMatchObject({ ok: true, action: 'send', images: 2 })
      expect(store.list(a.key).map((x) => [x.kind, x.path, x.state])).toEqual([
        ['image', shot(1), 'inserting'],
        ['image', shot(2), 'inserting'],
      ])
      expect(ws.panes.find((p) => p.key === a.key)).toMatchObject({ prefill: ' attached', prefillSubmit: true })
    })

    it('keeps the path prompt for Codex and a pane that is not idle', async () => {
      for (const [preset, status] of [['codex', 'idle'], ['claude', 'waiting']] as const) {
        const { a, store } = await idle(preset, status)
        expect(await send()).toMatchObject({ ok: true, action: 'send' })
        expect(store.list(a.key)).toEqual([])
        expect(prefillOf(a.key)).toBe('paths')
        ws.remove(a.key)
      }
    })

    it('says busy and attaches nothing when a prompt is already pending', async () => {
      const { a, store } = await idle('claude')
      ws.update(a.key, { prefill: 'earlier' })
      expect(await send()).toMatchObject({ ok: false, error: 'busy' })
      expect(store.list(a.key)).toEqual([])
    })

    it('refuses paths outside the bot folder of the project', async () => {
      const { a, store } = await idle('claude')
      const bad = ['C:\\work\\A\\secret.png', 'C:\\work\\B\\.orrery\\telegram\\x.png', 'C:\\work\\A\\.orrery\\telegram\\..\\..\\x.png', 'C:\\work\\A\\.orrery\\telegram\\note.txt']
      for (const path of bad) {
        expect(await send({ images: [shot(1), path] })).toMatchObject({ ok: true })
        expect(store.list(a.key)).toEqual([])
        expect(prefillOf(a.key)).toBe('paths')
        ws.update(a.key, { prefill: undefined, prefillSubmit: undefined })
      }
    })
  })
})
