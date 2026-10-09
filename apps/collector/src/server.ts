import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { sanitizeKinds, sanitizeQuiet, sanitizeStuck, type ClientMessage, type FocusWindowResult, type MonitorEvent, type ServerMessage } from '@ccm/shared'
import type { MonitorStore } from './store'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

/** Exit code the collector uses when its port is taken; apps/desktop/src/collector-host.ts matches it. */
export const PORT_IN_USE_EXIT = 3

export function isPortInUse(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function hostOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname
  } catch {
    return null
  }
}

/** Exact origin match: another app on localhost (other port) must not reach the WebSocket. */
export function isAllowedOrigin(origin: string, ports: readonly number[]): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname)) return false
  const port = Number(url.port || 80)
  return ports.includes(port) && origin === `http://${url.hostname}:${port}`
}

export function isLocalRequest(req: IncomingMessage, ports: readonly number[]): boolean {
  const host = hostOf(req.headers.host)
  if (!host || !LOCAL_HOSTS.has(host)) return false
  const origin = req.headers.origin
  return origin === undefined || isAllowedOrigin(origin, ports)
}

function decodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

async function serveStatic(webDist: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const root = path.resolve(webDist)
  const decoded = decodePath(url.pathname)
  if (decoded === null || decoded.includes('\0')) {
    res.writeHead(400).end()
    return
  }
  let file = path.resolve(root, `.${decoded}`)
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end()
    return
  }
  try {
    const st = await stat(file)
    if (st.isDirectory()) file = path.join(file, 'index.html')
  } catch {
    file = path.join(root, 'index.html')
  }
  try {
    await stat(file)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Web UI not built. Run: npm run build')
    return
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    // Only Vite's hashed bundles are immutable; sw.js / manifest / icons must revalidate or updates never land.
    'cache-control': file.startsWith(path.join(root, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  const stream = createReadStream(file)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

/** Per-request answer channel: `reply` goes to the asking socket only. */
export interface ClientContext {
  reply: (event: MonitorEvent) => void
  clients: number
  clientId: number
}

export interface FocusPageText {
  opening: string
  opened: string
}

export function focusPage(terminalId: string | null, key: string, text: FocusPageText): string {
  const data = JSON.stringify({ t: terminalId, k: key, opened: text.opened }).replaceAll('<', '\\u003c')
  const opening = text.opening.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  return `<!doctype html><meta charset="utf-8"><title>Claude Code Monitor</title><body style="font-family:system-ui,sans-serif;padding:2rem"><p id="m">${opening}</p><script>
const d = ${data}
if (!d.t) location.replace('/')
else fetch('/focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: d.t, k: d.k }) })
  .then((r) => (r.ok ? r.json() : { result: 'failed' }))
  .catch(() => ({ result: 'failed' }))
  .then((r) => {
    if (r.result !== 'ok') return location.replace('/?focus=' + encodeURIComponent(d.t))
    document.getElementById('m').textContent = d.opened
    window.close()
  })
</script>`
}

export function snoozePage(text: string): string {
  const safe = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  return `<!doctype html><meta charset="utf-8"><title>Claude Code Monitor</title><body style="font-family:system-ui,sans-serif;padding:2rem"><p>${safe}</p><script>window.close()</script>`
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

export function startServer(options: {
  host: string
  port: number
  webDist: string
  store: MonitorStore
  /** Extra origin ports allowed to connect (Vite dev server). */
  devOriginPorts?: readonly number[]
  heartbeatMs?: number
  onClientMessage?: (message: ClientMessage, ctx: ClientContext) => void
  onClientClose?: (clientId: number) => void
  onFocusLink?: (terminalId: string | null, key: string | null) => FocusPageText | null
  onFocusRun?: (terminalId: string, key: string | null) => Promise<FocusWindowResult | null>
  onSnoozeLink?: (terminalId: string, key: string | null, minutes: number) => string | null
}): Promise<Server> {
  const { store } = options
  const ports = [options.port, ...(options.devOriginPorts ?? [])]
  const server = createServer((req, res) => {
    if (!isLocalRequest(req, ports)) {
      res.writeHead(403).end()
      return
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, seq: store.seq }))
      return
    }
    if (req.url?.startsWith('/focus?') && req.method === 'GET') {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams
      const terminalId = q.get('t')
      const key = q.get('k')
      const text = key && (terminalId === null || terminalId.length <= 256) ? options.onFocusLink?.(terminalId, key) : null
      res
        .writeHead(text && key ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        .end(text && key ? focusPage(terminalId, key, text) : '')
      return
    }
    if (req.url?.startsWith('/snooze?') && req.method === 'GET') {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams
      const terminalId = q.get('t')
      const minutes = Number(q.get('m'))
      const text =
        terminalId && terminalId.length <= 256 && Number.isInteger(minutes) && minutes > 0 ? (options.onSnoozeLink?.(terminalId, q.get('k'), minutes) ?? null) : null
      res
        .writeHead(text ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        .end(text ? snoozePage(text) : '')
      return
    }
    if (req.url === '/focus' && req.method === 'POST') {
      void readBody(req, 2048).then(async (raw) => {
        let body: { t?: unknown; k?: unknown } = {}
        try {
          body = raw ? (JSON.parse(raw) as typeof body) : {}
        } catch {
          body = {}
        }
        const result =
          typeof body.t === 'string' && body.t.length <= 256 && typeof body.k === 'string' ? await (options.onFocusRun?.(body.t, body.k) ?? null) : null
        if (res.headersSent || res.destroyed) return
        res
          .writeHead(result ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify({ result: result ?? 'rejected' }))
      })
      return
    }
    serveStatic(options.webDist, req, res).catch((err: unknown) => {
      console.error('[collector] static:', (err as Error).message)
      if (!res.headersSent) res.writeHead(500).end()
      else res.destroy()
    })
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })
  const clients = new Set<WebSocket>()
  const alive = new WeakMap<WebSocket, boolean>()

  // Sockets silently die after sleep/hibernate; without pings they leak and keep receiving broadcasts.
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (alive.get(ws) === false) {
        clients.delete(ws)
        ws.terminate()
        continue
      }
      alive.set(ws, false)
      try {
        ws.ping()
      } catch {
        clients.delete(ws)
      }
    }
  }, options.heartbeatMs ?? 30_000)
  heartbeat.unref()
  server.on('close', () => clearInterval(heartbeat))

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/ws' || !isLocalRequest(req, ports)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }

  let nextClientId = 0
  wss.on('connection', (ws) => {
    const clientId = ++nextClientId
    clients.add(ws)
    alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))
    send(ws, store.snapshotMessage())
    const ctx = (): ClientContext => ({ reply: (event) => send(ws, { seq: -1, direct: true, events: [event] }), clients: clients.size, clientId })
    ws.on('message', (data) => {
      try {
        const msg: unknown = JSON.parse(String(data))
        if (typeof msg !== 'object' || msg === null) return
        const m = msg as { type?: unknown; attentive?: unknown; locale?: unknown; toast?: unknown; kinds?: unknown; quiet?: unknown; minutes?: unknown; stuckMinutes?: unknown; note?: unknown; dirs?: unknown; terminalId?: unknown; alias?: unknown; dir?: unknown; mode?: unknown; label?: unknown; app?: unknown; requestId?: unknown; jobId?: unknown }
        if (m.type === 'resync') {
          send(ws, store.snapshotMessage())
        } else if (m.type === 'terminal.alias' && typeof m.terminalId === 'string' && (typeof m.alias === 'string' || m.alias === null)) {
          options.onClientMessage?.({ type: 'terminal.alias', terminalId: m.terminalId, alias: m.alias }, ctx())
        } else if (m.type === 'favorite.toggle' && typeof m.terminalId === 'string') {
          options.onClientMessage?.({ type: 'favorite.toggle', terminalId: m.terminalId }, ctx())
        } else if (m.type === 'favorite.rename' && typeof m.dir === 'string' && (typeof m.label === 'string' || m.label === null)) {
          options.onClientMessage?.({ type: 'favorite.rename', dir: m.dir, label: m.label }, ctx())
        } else if (m.type === 'favorite.remove' && typeof m.dir === 'string') {
          options.onClientMessage?.({ type: 'favorite.remove', dir: m.dir }, ctx())
        } else if (m.type === 'favorite.reorder' && Array.isArray(m.dirs) && m.dirs.length <= 100 && m.dirs.every((d) => typeof d === 'string' && d.length <= 1024)) {
          options.onClientMessage?.({ type: 'favorite.reorder', dirs: m.dirs as string[] }, ctx())
        } else if (m.type === 'favorite.add' && typeof m.dir === 'string' && (m.label === undefined || m.label === null || typeof m.label === 'string')) {
          options.onClientMessage?.({ type: 'favorite.add', dir: m.dir, label: m.label }, ctx())
        } else if (m.type === 'folder.pick' && typeof m.requestId === 'string' && m.requestId.length <= 64) {
          options.onClientMessage?.({ type: 'folder.pick', requestId: m.requestId }, ctx())
        } else if (m.type === 'terminal.open' && typeof m.terminalId === 'string' && (m.app === 'explorer' || m.app === 'vscode')) {
          options.onClientMessage?.({ type: 'terminal.open', terminalId: m.terminalId, app: m.app }, ctx())
        } else if (m.type === 'history.get' || m.type === 'timeline.get' || m.type === 'diagnostics.get') {
          options.onClientMessage?.({ type: m.type }, ctx())
        } else if (m.type === 'terminal.focusWindow' && typeof m.terminalId === 'string') {
          options.onClientMessage?.({ type: 'terminal.focusWindow', terminalId: m.terminalId }, ctx())
        } else if (m.type === 'terminal.dismiss' && (m.terminalId === undefined || typeof m.terminalId === 'string')) {
          options.onClientMessage?.({ type: 'terminal.dismiss', terminalId: m.terminalId }, ctx())
        } else if (m.type === 'job.dismiss' && (m.jobId === undefined || (typeof m.jobId === 'string' && m.jobId.length <= 64))) {
          options.onClientMessage?.({ type: 'job.dismiss', jobId: m.jobId }, ctx())
        } else if (m.type === 'job.stop' && typeof m.jobId === 'string' && m.jobId.length <= 64) {
          options.onClientMessage?.({ type: 'job.stop', jobId: m.jobId }, ctx())
        } else if (m.type === 'client.presence' && typeof m.attentive === 'boolean') {
          options.onClientMessage?.({ type: 'client.presence', attentive: m.attentive, locale: m.locale === 'en' || m.locale === 'vi' ? m.locale : undefined }, ctx())
        } else if (m.type === 'notify.update' && (m.toast === undefined || typeof m.toast === 'boolean')) {
          const kinds = m.kinds === undefined ? undefined : sanitizeKinds(m.kinds)
          const quiet = m.quiet === undefined ? undefined : sanitizeQuiet(m.quiet)
          const stuckMinutes = m.stuckMinutes === undefined ? undefined : sanitizeStuck(m.stuckMinutes)
          if (kinds !== null && quiet !== null && stuckMinutes !== null) options.onClientMessage?.({ type: 'notify.update', toast: m.toast, kinds, quiet, stuckMinutes }, ctx())
        } else if (m.type === 'notify.test') {
          options.onClientMessage?.({ type: 'notify.test' }, ctx())
        } else if (m.type === 'terminal.note' && typeof m.terminalId === 'string' && (m.note === null || (typeof m.note === 'string' && m.note.length <= 1000))) {
          options.onClientMessage?.({ type: 'terminal.note', terminalId: m.terminalId, note: m.note }, ctx())
        } else if (
          m.type === 'terminal.snooze' &&
          typeof m.terminalId === 'string' &&
          (m.minutes === null || (typeof m.minutes === 'number' && Number.isFinite(m.minutes)))
        ) {
          options.onClientMessage?.({ type: 'terminal.snooze', terminalId: m.terminalId, minutes: m.minutes }, ctx())
        } else if (m.type === 'favorite.open' && typeof m.dir === 'string' && (m.mode === 'new' || m.mode === 'continue')) {
          options.onClientMessage?.({ type: 'favorite.open', dir: m.dir, mode: m.mode }, ctx())
        }
      } catch {
        return
      }
    })
    ws.on('close', () => {
      clients.delete(ws)
      options.onClientClose?.(clientId)
    })
    ws.on('error', () => clients.delete(ws))
  })

  store.subscribe((message) => {
    for (const ws of clients) send(ws, message)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => resolve(server))
  })
}
