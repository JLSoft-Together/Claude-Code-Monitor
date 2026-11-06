import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createOrrery, createPageAsker, type OrreryDeps } from '../src/orreryApi'
import { MCP_TOOL_ACTION, ORRERY_ACTIONS, TELEGRAM_INBOUND_ACTION, parseMcpDeskCall, parseMcpPageCall, type OrreryRequest } from '../../../packages/shared/src/orreryApi'

const SID = '0f8fad5b-d9cb-469f-a165-70867728950e'

function deps(over: Partial<OrreryDeps> = {}) {
  const page = vi.fn(async (req: OrreryRequest): Promise<unknown> => ({ ok: true, paneKey: 'p1', seen: req.action }))
  const desk = vi.fn(async (): Promise<unknown> => ({ ok: true, tool: 'list_servers', servers: [] }))
  const shot = vi.fn(async (): Promise<unknown> => ({ ok: true, tool: 'device_screenshot' }))
  const d: OrreryDeps = { page, desk, main: { 'device.screenshot': shot }, newId: () => 'req-1', ...over }
  return { call: createOrrery(d), page, desk, shot }
}

const open = { id: 't1', preset: 'claude', cwd: 'C:\\work\\A' }
const mcpCall = { id: 'c1', tool: 'notify_owner', from: 'pty-a', cwd: 'C:\\work\\A', text: 'done', level: 'done', merged: 0 }
const deskCall = { id: 'd1', tool: 'list_servers', from: 'pty-a', cwd: 'C:\\work\\A', pid: 42, name: 'A' }

describe('Orrery dispatcher', () => {
  it('routes page, desk and main actions', async () => {
    const { call, page, desk, shot } = deps()
    expect(await call('session.open', open, { source: 'url' })).toMatchObject({ ok: true, paneKey: 'p1' })
    expect(page).toHaveBeenCalledWith({ id: 'req-1', action: 'session.open', args: open, caller: { source: 'url' } })
    await call('port.list', deskCall, { source: 'mcp', pane: 'pty-a' })
    expect(desk).toHaveBeenCalledWith(deskCall)
    await call('device.screenshot', { id: 'c2', tool: 'device_screenshot', from: 'pty-a', cwd: 'C:\\w' }, { source: 'mcp', pane: 'pty-a' })
    expect(shot).toHaveBeenCalledOnce()
    expect(page).toHaveBeenCalledOnce()
  })

  it('refuses a source the action does not allow', async () => {
    const { call, page, desk } = deps()
    expect(await call('session.open', open, { source: 'telegram' })).toEqual({ ok: false, error: 'source' })
    expect(await call('owner.notify', mcpCall, { source: 'url' })).toEqual({ ok: false, error: 'source' })
    expect(await call('port.free', { ...deskCall, tool: 'free_port', port: 80 }, { source: 'telegram' })).toEqual({ ok: false, error: 'source' })
    expect(await call('session.send', { id: 'x', action: 'send', project: 'C:\\A', text: 'hi', from: 'me' }, { source: 'mcp', pane: 'p' })).toEqual({ ok: false, error: 'source' })
    expect(await call('session.open', open, { source: 'bogus' } as never)).toEqual({ ok: false, error: 'source' })
    // An MCP call only speaks for the pane whose token the host checked.
    expect(await call('owner.notify', mcpCall, { source: 'mcp', pane: 'pty-b' })).toEqual({ ok: false, error: 'source' })
    expect(page).not.toHaveBeenCalled()
    expect(desk).not.toHaveBeenCalled()
  })

  it('refuses unknown actions and junk arguments before anything runs', async () => {
    const { call, page } = deps()
    expect(await call('session.nuke', open, { source: 'url' })).toEqual({ ok: false, error: 'unknown' })
    expect(await call('toString', open, { source: 'url' })).toEqual({ ok: false, error: 'unknown' })
    for (const bad of [null, 'x', [], { ...open, preset: 'bash' }, { ...open, cwd: '' }, { ...open, cwd: 'C:\\a\0b' }, { ...open, resume: 'nope' }, { ...open, id: 'x'.repeat(101) }])
      expect(await call('session.open', bad, { source: 'url' })).toEqual({ ok: false, error: 'args' })
    expect(await call('owner.notify', { ...mcpCall, level: 'loud' }, { source: 'mcp', pane: 'pty-a' })).toEqual({ ok: false, error: 'args' })
    expect(await call('owner.notify', { ...mcpCall, tool: 'hand_back' }, { source: 'mcp', pane: 'pty-a' })).toEqual({ ok: false, error: 'args' })
    expect(page).not.toHaveBeenCalled()
  })

  it('passes a typed copy, never extra fields', async () => {
    const { call, page } = deps()
    await call('session.open', { ...open, resume: SID, prompt: ' hi\x07 ', evil: 1 }, { source: 'url' })
    expect(page.mock.calls[0]![0].args).toEqual({ ...open, resume: SID, prompt: 'hi' })
  })

  it('runs the after-hook on a page answer, and fails closed when a route throws', async () => {
    const after = vi.fn((res: unknown) => ({ wrapped: res }))
    const { call } = deps({ after: { 'owner.notify': after } })
    expect(await call('owner.notify', mcpCall, { source: 'mcp', pane: 'pty-a' })).toEqual({ wrapped: { ok: true, paneKey: 'p1', seen: 'owner.notify' } })
    const broken = deps({ desk: async () => Promise.reject(new Error('x')) })
    expect(await broken.call('port.list', deskCall, { source: 'mcp', pane: 'pty-a' })).toEqual({ ok: false, error: 'failed' })
  })

  it('maps every MCP tool and bot action onto the table', () => {
    for (const action of [...Object.values(MCP_TOOL_ACTION), ...Object.values(TELEGRAM_INBOUND_ACTION)]) expect(ORRERY_ACTIONS[action]).toBeDefined()
    expect(ORRERY_ACTIONS['session.resume'].sources).toEqual(['telegram'])
    expect(ORRERY_ACTIONS['session.handBack'].sources).toEqual(['mcp'])
  })

  it('parses MCP page and desk calls field by field', () => {
    expect(parseMcpPageCall({ id: 'a', tool: 'run_app', from: 'p', cwd: 'C:\\w', action: 'start', config: '-x' }, 'run_app')).toBeNull()
    expect(parseMcpPageCall({ id: 'a', tool: 'run_log', from: 'p', cwd: 'C:\\w', lines: 9999 }, 'run_log')).toMatchObject({ lines: 200, errorsOnly: false })
    expect(parseMcpDeskCall({ ...deskCall, tool: 'free_port', port: 70000 }, 'free_port')).toBeNull()
    expect(parseMcpDeskCall({ ...deskCall, pid: -1 }, 'list_servers')).toBeNull()
    expect(parseMcpDeskCall({ ...deskCall, tool: 'telegram_receive', state: 'on' }, 'telegram_receive')).toMatchObject({ state: 'on' })
  })
})

describe('page asker', () => {
  function setup(target: { send: ReturnType<typeof vi.fn> } | null, trusted = true) {
    const ipc = new EventEmitter()
    const ask = createPageAsker<{ sender: unknown }>({
      target: () => target,
      on: (ch, l) => void ipc.on(ch, l),
      off: (ch, l) => void ipc.off(ch, l),
      trusted: () => trusted,
      timeoutMs: 1000,
    })
    return { ipc, ask }
  }
  const req: OrreryRequest = { id: 'r1', action: 'session.open', args: open, caller: { source: 'url' } }

  it('answers unavailable at once when the page is not there', async () => {
    expect(await setup(null).ask(req)).toEqual({ ok: false, error: 'unavailable' })
  })

  it('takes the reply with its id from the page only', async () => {
    const contents = { send: vi.fn() }
    const { ipc, ask } = setup(contents)
    const out = ask(req)
    expect(contents.send).toHaveBeenCalledWith('ccm:orrery', req)
    ipc.emit('ccm:orrery-reply', { sender: {} }, 'r1', 'spoofed')
    ipc.emit('ccm:orrery-reply', { sender: contents }, 'other', 'wrong id')
    ipc.emit('ccm:orrery-reply', { sender: contents }, 'r1', { ok: true, paneKey: 'k' })
    expect(await out).toEqual({ ok: true, paneKey: 'k' })
    expect(ipc.listenerCount('ccm:orrery-reply')).toBe(0)
  })

  it('times out to unavailable and ignores replies from untrusted frames', async () => {
    vi.useFakeTimers()
    try {
      const contents = { send: vi.fn() }
      const { ipc, ask } = setup(contents, false)
      const out = ask(req)
      ipc.emit('ccm:orrery-reply', { sender: contents }, 'r1', { ok: true, paneKey: 'k' })
      vi.advanceTimersByTime(1000)
      expect(await out).toEqual({ ok: false, error: 'unavailable' })
      expect(ipc.listenerCount('ccm:orrery-reply')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
