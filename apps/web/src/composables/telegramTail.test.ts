import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TELEGRAM_INBOUND_ACTION, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'

type Handler = (raw: unknown) => TelegramInboundResult | Promise<TelegramInboundResult>

describe('telegram tail (inbound handler)', () => {
  let handler: Handler
  let ws: Awaited<ReturnType<typeof boot>>['ws']
  let snaps: typeof import('../lib/paneSnapshots')

  async function boot() {
    vi.resetModules()
    setActivePinia(createPinia())
    ;(window as unknown as { ccmDesktop: unknown }).ccmDesktop = { platform: 'win32', onOrrery: () => undefined, telegramPanes: async () => true }
    const mod = await import('./useTelegramInbound')
    const orrery = await import('./useOrreryApi')
    // Same adapter as main: the bot's request goes through the Orrery executor under its action name.
    const captured: Handler = (raw) => orrery.runOrrery(TELEGRAM_INBOUND_ACTION[(raw as TelegramInbound).action], raw, { source: 'telegram' }) as Promise<TelegramInboundResult>
    const store = await import('../stores/workspace')
    snaps = await import('../lib/paneSnapshots')
    mod.installTelegramInbound()
    return { handler: captured, ws: store.useWorkspaceStore() }
  }

  function pane(preset: 'claude' | 'codex', cwd: string, id: string) {
    const p = ws.open(preset, cwd)
    ws.update(p.key, { sessionId: `pty-${id}`, terminalId: `term-${id}`, state: 'running' })
    return ws.panes.find((x) => x.key === p.key)!
  }

  const ask = (extra: Record<string, unknown> = {}) => handler({ id: 'x', action: 'tail', project: 'C:\\work\\A', lines: 3, ...extra })

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    ;({ handler, ws } = await boot())
  })

  it('returns the last rows of the only pane buffer', async () => {
    const a = pane('claude', 'C:\\work\\A', 'a')
    snaps.registerSnapshot(a.key, () => ['old', 'l1', 'l2', 'l3', '', ''])
    expect(await ask()).toMatchObject({ ok: true, action: 'tail', text: 'l1\nl2\nl3' })
  })

  it('asks for a pick when several panes are open, and honours a target', async () => {
    const a = pane('claude', 'C:\\work\\A', 'a')
    const b = pane('codex', 'C:\\work\\A', 'b')
    snaps.registerSnapshot(a.key, () => ['from a'])
    snaps.registerSnapshot(b.key, () => ['from b'])
    expect(await ask()).toMatchObject({ ok: false, error: 'many' })
    expect(await ask({ target: { kind: 'terminal', terminalId: 'term-b' } })).toMatchObject({ ok: true, text: 'from b' })
  })

  it('reports gone when the pane has no mounted buffer or the target is closed', async () => {
    pane('claude', 'C:\\work\\A', 'a')
    expect(await ask()).toEqual({ ok: false, error: 'gone' })
    expect(await ask({ target: { kind: 'terminal', terminalId: 'term-zz' } })).toEqual({ ok: false, error: 'gone' })
    expect(await handler({ id: 'x', action: 'tail', project: 'C:\\work\\B', lines: 3 })).toEqual({ ok: false, error: 'none' })
  })

  it('clamps the line count', async () => {
    const a = pane('claude', 'C:\\work\\A', 'a')
    const seen: number[] = []
    snaps.registerSnapshot(a.key, (n) => {
      seen.push(n)
      return ['x']
    })
    await ask({ lines: 500 })
    await ask({ lines: -4 })
    expect(seen).toEqual([80, 1])
  })
})
