import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Orrery executor (page)', () => {
  let api: typeof import('./useOrreryApi')
  let installed: ((action: unknown, args: unknown, caller: unknown) => unknown) | undefined

  beforeEach(async () => {
    vi.resetModules()
    installed = undefined
    ;(window as unknown as { ccmDesktop: unknown }).ccmDesktop = { platform: 'win32', onOrrery: (h: typeof installed) => (installed = h) }
    api = await import('./useOrreryApi')
  })

  const open = { id: 't1', preset: 'claude', cwd: 'C:\\work\\A' }

  it('installs one handler on the preload and runs the registered action with a typed copy', async () => {
    api.installOrreryApi()
    const handler = vi.fn(() => ({ ok: true, paneKey: 'p1' }))
    api.handleOrrery('session.open', handler)
    expect(await installed!('session.open', { ...open, junk: 1 }, { source: 'mcp', pane: 'pty-a' })).toEqual({ ok: true, paneKey: 'p1' })
    expect(handler).toHaveBeenCalledWith(open, { source: 'mcp', pane: 'pty-a' })
  })

  it('answers unavailable until the owning composable registered, and checks source, args and runs', async () => {
    expect(await api.runOrrery('session.open', open, { source: 'url' })).toEqual({ ok: false, error: 'unavailable' })
    expect(await api.runOrrery('session.open', open, { source: 'telegram' })).toEqual({ ok: false, error: 'source' })
    expect(await api.runOrrery('session.open', open, null)).toEqual({ ok: false, error: 'source' })
    expect(await api.runOrrery('session.open', { ...open, preset: 'rm' }, { source: 'url' })).toEqual({ ok: false, error: 'args' })
    expect(await api.runOrrery('port.free', {}, { source: 'mcp' })).toEqual({ ok: false, error: 'unknown' })
    expect(await api.runOrrery('__proto__', {}, { source: 'mcp' })).toEqual({ ok: false, error: 'unknown' })
  })

  it('turns a throwing handler into failed', async () => {
    api.handleOrrery('session.open', () => {
      throw new Error('boom')
    })
    expect(await api.runOrrery('session.open', open, { source: 'url' })).toEqual({ ok: false, error: 'failed' })
  })
})
