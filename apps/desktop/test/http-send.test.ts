import { describe, expect, it, vi } from 'vitest'
import { classifyHost, cleanRequest, MAX_RESPONSE_BYTES, registerHttpIpc, sendHttp, type FetchLike } from '../src/preview/httpSend'

describe('classifyHost', () => {
  it('keeps loopback, private LAN, link-local and .local quiet', () => {
    for (const h of ['localhost', 'api.localhost', '127.0.0.1', '127.8.9.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.20', '169.254.1.1', '0.0.0.0', '[::1]', '::1', 'printer.local', 'fd12:3456::1', 'fe80::1', '::ffff:192.168.0.1', 'LOCALHOST.'])
      expect(classifyHost(h), h).toBe('local')
  })
  it('asks for everything else', () => {
    for (const h of ['example.com', '172.15.0.1', '172.32.0.1', '192.169.0.1', '8.8.8.8', '11.0.0.1', '2001:db8::1', '::ffff:8.8.8.8', 'local', 'localhost.evil.com', 'intranet', '999.1.1.1'])
      expect(classifyHost(h), h).toBe('public')
  })
})

describe('cleanRequest', () => {
  it('accepts a well formed request and normalizes the method', () => {
    expect(cleanRequest({ method: 'post', url: 'https://x.dev/a?b=1', headers: [['Content-Type', 'application/json']], body: '{}' })).toEqual({
      id: undefined,
      method: 'POST',
      url: 'https://x.dev/a?b=1',
      headers: [['Content-Type', 'application/json']],
      body: '{}',
    })
  })
  it('refuses other schemes, bad methods and header injection', () => {
    const base = { method: 'GET', url: 'http://a/', headers: [] as Array<[string, string]> }
    expect(cleanRequest({ ...base, url: 'file:///etc/passwd' })).toBeNull()
    expect(cleanRequest({ ...base, url: 'not a url' })).toBeNull()
    expect(cleanRequest({ ...base, method: 'GE T' })).toBeNull()
    expect(cleanRequest({ ...base, headers: [['X-A', 'v\r\nX-B: evil']] })).toBeNull()
    expect(cleanRequest({ ...base, headers: [['Bad Name', 'v']] })).toBeNull()
    expect(cleanRequest({ ...base, headers: 'x' })).toBeNull()
    expect(cleanRequest(null)).toBeNull()
  })
})

const reply = (body: BodyInit | null, init?: ResponseInit) => (async () => new Response(body, init)) as unknown as FetchLike

describe('sendHttp', () => {
  it('returns status, headers and text body without following redirects', async () => {
    let seen: Parameters<FetchLike>[1] | undefined
    const fetch: FetchLike = async (_url, init) => {
      seen = init
      return new Response('{"a":1}', { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' } })
    }
    const r = await sendHttp({ method: 'POST', url: 'http://localhost/x', headers: [['A', 'b']], body: 'x' }, { fetch })
    expect(r).toMatchObject({ ok: true, status: 201, statusText: 'Created', body: '{"a":1}', binary: false, truncated: false, size: 7 })
    expect(seen).toMatchObject({ method: 'POST', redirect: 'manual', body: 'x', headers: [['A', 'b']] })
  })

  it('caps the body at 5 MB and skips binary bodies', async () => {
    const big = await sendHttp({ method: 'GET', url: 'http://a/', headers: [] }, { fetch: reply('x'.repeat(MAX_RESPONSE_BYTES + 100)) })
    expect(big).toMatchObject({ ok: true, truncated: true, size: MAX_RESPONSE_BYTES })
    const img = await sendHttp({ method: 'GET', url: 'http://a/', headers: [] }, { fetch: reply('PNG', { headers: { 'content-type': 'image/png' } }) })
    expect(img).toMatchObject({ ok: true, binary: true, body: '', size: 3 })
  })

  it('times out, refuses a GET body and reports network errors', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    expect(await sendHttp({ method: 'GET', url: 'http://a/', headers: [] }, { fetch: hang, timeoutMs: 10 })).toEqual({ ok: false, error: 'timeout' })
    expect(await sendHttp({ method: 'GET', url: 'http://a/', headers: [], body: 'x' })).toEqual({ ok: false, error: 'get-body' })
    const down: FetchLike = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    }
    expect(await sendHttp({ method: 'GET', url: 'http://a/', headers: [] }, { fetch: down })).toEqual({ ok: false, error: 'network', detail: 'ECONNREFUSED' })
  })
})

describe('registerHttpIpc', () => {
  function setup(answer: boolean) {
    const handlers = new Map<string, (event: unknown, arg: unknown) => unknown>()
    const ipcMain = { handle: (ch: string, fn: (event: unknown, arg: unknown) => unknown) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) }
    const confirmHost = vi.fn(async () => answer)
    const dispose = registerHttpIpc({ ipcMain: ipcMain as never, isAppFrame: () => true, confirmHost, fetch: reply('ok') })
    const send = (url: string) => handlers.get('ccm:http-send')!({}, { method: 'GET', url, headers: [] })
    return { send, confirmHost, dispose, handlers }
  }

  it('asks once per public host, never for local ones', async () => {
    const { send, confirmHost } = setup(true)
    expect(await send('http://127.0.0.1:8080/a')).toMatchObject({ ok: true, body: 'ok' })
    expect(confirmHost).not.toHaveBeenCalled()
    await Promise.all([send('https://api.example.com/a'), send('https://api.example.com/b')])
    await send('https://API.example.com/c')
    expect(confirmHost).toHaveBeenCalledTimes(1)
    await send('https://other.example.com/')
    expect(confirmHost).toHaveBeenCalledTimes(2)
  })

  it('does not send when declined and asks again next time', async () => {
    const { send, confirmHost, dispose, handlers } = setup(false)
    expect(await send('https://api.example.com/')).toEqual({ ok: false, error: 'declined' })
    expect(await send('https://api.example.com/')).toEqual({ ok: false, error: 'declined' })
    expect(confirmHost).toHaveBeenCalledTimes(2)
    dispose()
    expect(handlers.size).toBe(0)
  })
})
