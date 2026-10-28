import type { IpcMain, IpcMainInvokeEvent } from 'electron'

export const HTTP_TIMEOUT_MS = 30_000
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
export const MAX_REQUEST_BODY = 10 * 1024 * 1024
const MAX_HEADERS = 100
const MAX_URL = 16 * 1024

export interface HttpRequest {
  id?: string
  method: string
  url: string
  headers: Array<[string, string]>
  body?: string
}

export type HttpResult =
  | { ok: true; status: number; statusText: string; headers: Array<[string, string]>; body: string; binary: boolean; truncated: boolean; size: number; timeMs: number; url: string }
  | { ok: false; error: 'bad-request' | 'get-body' | 'declined' | 'timeout' | 'cancelled' | 'network'; detail?: string }

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const BINARY_TYPE = /^(?:image|audio|video|font)\/|^application\/(?:octet-stream|pdf|zip|gzip|x-protobuf|protobuf|vnd\.)/i

function ipv4Local(host: string): boolean | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const [a, b] = [Number(m[1]), Number(m[2])]
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return null
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/**
 * Loopback / private LAN / link-local / mDNS names stay quiet; everything else asks once per host per session.
 * Decided by the name in the URL: a public name resolving to a LAN address still asks (the safe side).
 */
export function classifyHost(hostname: string): 'local' | 'public' {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return 'local'
  const v4 = ipv4Local(h)
  if (v4 !== null) return v4 ? 'local' : 'public'
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return 'local'
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
    if (mapped) return ipv4Local(mapped[1]!) ? 'local' : 'public'
    if (/^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h)) return 'local'
  }
  return 'public'
}

/** The page's request, checked: http(s) URL, token method, header names / values without line breaks. */
export function cleanRequest(input: unknown): HttpRequest | null {
  const r = input as Partial<HttpRequest> | null
  if (!r || typeof r !== 'object') return null
  const method = typeof r.method === 'string' ? r.method.toUpperCase() : ''
  if (!TOKEN.test(method) || method.length > 16) return null
  if (typeof r.url !== 'string' || r.url.length > MAX_URL) return null
  let url: URL
  try {
    url = new URL(r.url)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!Array.isArray(r.headers) || r.headers.length > MAX_HEADERS) return null
  const headers: Array<[string, string]> = []
  for (const pair of r.headers) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') return null
    if (!TOKEN.test(pair[0]) || /[\r\n\0]/.test(pair[1]) || pair[1].length > 16 * 1024) return null
    headers.push([pair[0], pair[1]])
  }
  if (r.body !== undefined && (typeof r.body !== 'string' || r.body.length > MAX_REQUEST_BODY)) return null
  const id = typeof r.id === 'string' && r.id.length <= 64 ? r.id : undefined
  return { id, method, url: url.href, headers, body: r.body }
}

export type FetchLike = (url: string, init: { method: string; headers: Array<[string, string]>; body?: string; redirect: 'manual'; signal: AbortSignal }) => Promise<Response>

async function readCapped(res: Response): Promise<{ bytes: Uint8Array; size: number; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) return { bytes: new Uint8Array(), size: 0, truncated: false }
  const parts: Uint8Array[] = []
  let size = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const room = MAX_RESPONSE_BYTES - size
    if (value.length > room) {
      parts.push(value.subarray(0, room))
      size += room
      truncated = true
      await reader.cancel().catch(() => undefined)
      break
    }
    parts.push(value)
    size += value.length
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  return { bytes, size, truncated }
}

/** Redirects are not followed (a redirect to another host would skip its confirm); the 3xx and Location show instead. */
export async function sendHttp(req: HttpRequest, opts: { fetch?: FetchLike; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<HttpResult> {
  if (req.body !== undefined && req.body !== '' && (req.method === 'GET' || req.method === 'HEAD')) return { ok: false, error: 'get-body' }
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, opts.timeoutMs ?? HTTP_TIMEOUT_MS)
  const onAbort = () => ctl.abort()
  opts.signal?.addEventListener('abort', onAbort)
  const started = performance.now()
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike)
  try {
    const res = await doFetch(req.url, { method: req.method, headers: req.headers, body: req.body || undefined, redirect: 'manual', signal: ctl.signal })
    const { bytes, size, truncated } = await readCapped(res)
    const timeMs = Math.round(performance.now() - started)
    const headers: Array<[string, string]> = []
    res.headers.forEach((value, name) => headers.push([name, value]))
    const binary = BINARY_TYPE.test(res.headers.get('content-type') ?? '')
    const body = binary ? '' : new TextDecoder('utf-8').decode(bytes)
    return { ok: true, status: res.status, statusText: res.statusText, headers, body, binary, truncated, size, timeMs, url: req.url }
  } catch (err) {
    if (timedOut) return { ok: false, error: 'timeout' }
    if (ctl.signal.aborted) return { ok: false, error: 'cancelled' }
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
    if (e?.name === 'TypeError' && !e.cause) return { ok: false, error: 'bad-request', detail: String(e.message ?? '').slice(0, 200) }
    return { ok: false, error: 'network', detail: String(e?.cause?.code ?? e?.cause?.message ?? e?.message ?? '').slice(0, 200) }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

export interface HttpIpcDeps {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  /** Native confirm for a public host; true = send. */
  confirmHost: (event: IpcMainInvokeEvent, host: string, method: string) => Promise<boolean>
  fetch?: FetchLike
}

/** `ccm:http-send` / `ccm:http-cancel`. Bodies never reach a log. */
export function registerHttpIpc(deps: HttpIpcDeps): () => void {
  const allowed = new Set<string>()
  const asking = new Map<string, Promise<boolean>>()
  const running = new Map<string, AbortController>()

  async function hostOk(event: IpcMainInvokeEvent, url: URL, method: string): Promise<boolean> {
    const host = url.hostname.toLowerCase()
    if (classifyHost(host) === 'local' || allowed.has(host)) return true
    let ask = asking.get(host)
    if (!ask) {
      ask = deps.confirmHost(event, host, method).finally(() => asking.delete(host))
      asking.set(host, ask)
    }
    const ok = await ask
    if (ok) allowed.add(host)
    return ok
  }

  deps.ipcMain.handle('ccm:http-send', async (event, input: unknown): Promise<HttpResult> => {
    if (!deps.isAppFrame(event)) return { ok: false, error: 'bad-request' }
    const req = cleanRequest(input)
    if (!req) return { ok: false, error: 'bad-request' }
    if (!(await hostOk(event, new URL(req.url), req.method))) return { ok: false, error: 'declined' }
    const ctl = new AbortController()
    if (req.id) {
      running.get(req.id)?.abort()
      running.set(req.id, ctl)
    }
    try {
      return await sendHttp(req, { fetch: deps.fetch, signal: ctl.signal })
    } finally {
      if (req.id && running.get(req.id) === ctl) running.delete(req.id)
    }
  })
  deps.ipcMain.handle('ccm:http-cancel', (event, id: unknown) => {
    if (!deps.isAppFrame(event) || typeof id !== 'string') return false
    running.get(id)?.abort()
    return running.delete(id)
  })
  return () => {
    for (const c of running.values()) c.abort()
    running.clear()
    deps.ipcMain.removeHandler('ccm:http-send')
    deps.ipcMain.removeHandler('ccm:http-cancel')
  }
}
