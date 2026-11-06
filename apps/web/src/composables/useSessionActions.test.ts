import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TELEGRAM_INBOUND_ACTION, type PtyPreset, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'

type Handler = (raw: unknown) => TelegramInboundResult | Promise<TelegramInboundResult>

describe('session actions (resolveTarget + Telegram adapter)', () => {
  let handler: Handler
  let ws: Awaited<ReturnType<typeof boot>>['ws']
  let act: Awaited<ReturnType<typeof boot>>['act']

  async function boot() {
    vi.resetModules()
    setActivePinia(createPinia())
    ;(window as unknown as { ccmDesktop: unknown }).ccmDesktop = { platform: 'win32', onOrrery: () => undefined, telegramPanes: async () => true }
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

  describe('Telegram adapter', () => {
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
})
