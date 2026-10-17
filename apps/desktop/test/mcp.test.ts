import { describe, expect, it, vi } from 'vitest'
import { handleMcp, MCP_PROTOCOL_VERSION, mcpGate, OPEN_SESSION_TOOL, toOpenResult, type OpenArgs, type OpenOutcome } from '../src/pty/mcp'

const uuid = '0b3c1f9e-1111-4222-8333-444455556666'
const opened: OpenOutcome = { ok: true, preset: 'claude', cwd: 'D:\\work\\app', sessionId: uuid, prompt: true }
const never = (): Promise<OpenOutcome> => Promise.reject(new Error('not expected'))
const call = (id: number, name: string, args?: unknown) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })

describe('mcp json-rpc', () => {
  it('initialize echoes a dated protocol version and falls back otherwise', async () => {
    const res = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } }, never, '2.6.0')
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'orrery', version: '2.6.0' } },
    })
    expect((res.json as { result: { instructions: string } }).result.instructions).toContain('open_session')
    const odd = await handleMcp({ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: 'latest' } }, never, '0')
    expect(odd.json).toMatchObject({ id: 'a', result: { protocolVersion: MCP_PROTOCOL_VERSION } })
  })

  it('accepts notifications and responses without answering', async () => {
    expect(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, never, '0')).toEqual({ status: 202 })
    expect(await handleMcp({ jsonrpc: '2.0', id: 9, result: {} }, never, '0')).toEqual({ status: 202 })
    expect(await handleMcp([{ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }], never, '0')).toEqual({ status: 202 })
  })

  it('answers a batch in order, skipping notifications', async () => {
    const res = await handleMcp(
      [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }],
      never,
      '0',
    )
    expect(res.status).toBe(200)
    const out = res.json as { id: number; result: unknown }[]
    expect(out.map((r) => r.id)).toEqual([1, 2])
    expect(out[0]!.result).toEqual({})
    expect(await handleMcp([], never, '0')).toEqual({ status: 200, json: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } } })
  })

  it('lists open_session with a closed schema', async () => {
    const res = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, never, '0')
    const tools = (res.json as { result: { tools: (typeof OPEN_SESSION_TOOL)[] } }).result.tools
    expect(tools).toHaveLength(1)
    const tool = tools[0]!
    expect(tool.name).toBe('open_session')
    expect(tool.description).toContain('instead of starting a terminal window')
    expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(['agent', 'cwd', 'name', 'prompt', 'resume'])
    expect(tool.inputSchema.properties.agent.enum).toEqual(['claude', 'codex', 'shell'])
    expect(tool.inputSchema.properties.prompt.maxLength).toBe(8000)
    expect(tool.annotations).toEqual({ title: 'Open Orrery session', readOnlyHint: false, destructiveHint: false, openWorldHint: false })
  })

  it('opens a session and describes it', async () => {
    const open = vi.fn((_args: OpenArgs) => Promise.resolve(opened))
    const res = await handleMcp(call(4, 'open_session', { agent: 'claude', prompt: 'hi' }), open, '0')
    expect(open).toHaveBeenCalledWith({ agent: 'claude', prompt: 'hi' })
    const result = (res.json as { id: number; result: { content: { type: string; text: string }[]; structuredContent: unknown; isError?: boolean } }).result
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual(opened)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: `Opened Claude Code in D:\\work\\app as a new Orrery pane next to this session. Session id: ${uuid}. The prompt is waiting in its input box; the user presses Enter to send it.`,
      },
    ])
    const shell = await handleMcp(call(5, 'open_session'), () => Promise.resolve({ ok: true, preset: 'shell', cwd: '/srv', prompt: false }), '0')
    expect(open).toHaveBeenCalledTimes(1)
    expect((shell.json as { result: { content: { text: string }[] } }).result.content[0]!.text).toBe('Opened a shell in /srv as a new Orrery pane next to this session.')
    const resumed = await handleMcp(call(8, 'open_session', { resume: uuid }), () => Promise.resolve({ ok: true, preset: 'codex', cwd: '/srv', sessionId: uuid, prompt: false, resumed: true }), '0')
    expect((resumed.json as { result: { content: { text: string }[] } }).result.content[0]!.text).toBe(`Reopened Codex session ${uuid} in /srv as an Orrery pane.`)
  })

  it('reports refusals as tool errors that discourage an external terminal', async () => {
    for (const error of ['limit', 'cwd', 'rate', 'unavailable', 'preset', 'failed', 'resume', 'live'] as const) {
      const res = await handleMcp(call(6, 'open_session', { cwd: 'relative' }), () => Promise.resolve({ ok: false, error }), '0')
      const result = (res.json as { result: { content: { text: string }[]; structuredContent: unknown; isError?: boolean } }).result
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toEqual({ ok: false, error })
      expect(result.content[0]!.text.endsWith('Do not open an external terminal window instead unless the user asks for it.')).toBe(true)
    }
    const thrown = await handleMcp(call(7, 'open_session'), () => Promise.reject(new Error('x')), '0')
    expect(thrown.json).toMatchObject({ result: { isError: true, structuredContent: { ok: false, error: 'failed' } } })
  })

  it('rejects unknown methods, tools and malformed messages', async () => {
    expect((await handleMcp({ jsonrpc: '2.0', id: 8, method: 'resources/list' }, never, '0')).json).toEqual({
      jsonrpc: '2.0',
      id: 8,
      error: { code: -32601, message: 'Method not found' },
    })
    expect((await handleMcp(call(9, 'run_shell', {}), never, '0')).json).toMatchObject({ id: 9, error: { code: -32602 } })
    expect((await handleMcp(call(10, 'open_session', 'x'), never, '0')).json).toMatchObject({ id: 10, error: { code: -32602 } })
    const invalid = { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
    for (const bad of [null, 42, 'ping', { id: 1, method: 'ping' }, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: {}, method: 'ping' }])
      expect((await handleMcp(bad, never, '0')).json).toEqual(invalid)
  })

  it('validates the page reply', () => {
    expect(toOpenResult({ ok: true, paneKey: 'p1' })).toEqual({ ok: true, paneKey: 'p1' })
    expect(toOpenResult({ ok: false, error: 'limit' })).toEqual({ ok: false, error: 'limit' })
    expect(toOpenResult({ ok: false, error: 'weird' })).toEqual({ ok: false, error: 'failed' })
    for (const bad of [null, 'ok', { ok: 'yes' }, { ok: false }]) expect(toOpenResult(bad)).toBeNull()
  })
})

describe('mcp gate', () => {
  const token = 'ab'.repeat(32)
  const base = { method: 'POST', url: '/mcp', host: '127.0.0.1:4500', authorization: `Bearer ${token}` }

  it('lets a local bearer POST through', () => {
    expect(mcpGate(base, 4500)).toEqual({ token })
    expect(mcpGate({ ...base, url: '/mcp?x=1', authorization: `bearer ${token}` }, 4500)).toEqual({ token })
  })

  it('refuses other paths, hosts, browsers and methods', () => {
    expect(mcpGate({ ...base, url: '/pty' }, 4500)).toEqual({ status: 404 })
    expect(mcpGate({ ...base, url: '/mcp/x' }, 4500)).toEqual({ status: 404 })
    expect(mcpGate({ ...base, host: 'localhost:4500' }, 4500)).toEqual({ status: 403 })
    expect(mcpGate({ ...base, host: '127.0.0.1:4501' }, 4500)).toEqual({ status: 403 })
    expect(mcpGate({ ...base, origin: 'https://evil.example' }, 4500)).toEqual({ status: 403 })
    expect(mcpGate({ ...base, origin: 'null' }, 4500)).toEqual({ status: 403 })
    expect(mcpGate({ ...base, method: 'GET' }, 4500)).toEqual({ status: 405, allow: 'POST' })
    expect(mcpGate({ ...base, method: 'DELETE' }, 4500)).toEqual({ status: 405, allow: 'POST' })
    expect(mcpGate({ ...base, method: 'PUT' }, 4500)).toMatchObject({ status: 405 })
  })

  it('needs a well-formed bearer token', () => {
    for (const authorization of [undefined, '', token, `Basic ${token}`, `Bearer ${token.toUpperCase()}`, `Bearer ${token}0`, `Bearer  ${token}`, 'Bearer ${ORRERY_TOKEN}'])
      expect(mcpGate({ ...base, authorization }, 4500)).toEqual({ status: 401 })
  })
})
