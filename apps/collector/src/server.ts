import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@ccm/shared'
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

export function startServer(options: {
  host: string
  port: number
  webDist: string
  store: MonitorStore
  /** Extra origin ports allowed to connect (Vite dev server). */
  devOriginPorts?: readonly number[]
  heartbeatMs?: number
  onClientMessage?: (message: ClientMessage) => void
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

  wss.on('connection', (ws) => {
    clients.add(ws)
    alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))
    send(ws, store.snapshotMessage())
    ws.on('message', (data) => {
      try {
        const msg: unknown = JSON.parse(String(data))
        if (typeof msg !== 'object' || msg === null) return
        const m = msg as { type?: unknown; terminalId?: unknown; alias?: unknown; dir?: unknown; mode?: unknown; label?: unknown }
        if (m.type === 'resync') {
          send(ws, store.snapshotMessage())
        } else if (m.type === 'terminal.alias' && typeof m.terminalId === 'string' && (typeof m.alias === 'string' || m.alias === null)) {
          options.onClientMessage?.({ type: 'terminal.alias', terminalId: m.terminalId, alias: m.alias })
        } else if (m.type === 'favorite.toggle' && typeof m.terminalId === 'string') {
          options.onClientMessage?.({ type: 'favorite.toggle', terminalId: m.terminalId })
        } else if (m.type === 'favorite.rename' && typeof m.dir === 'string' && (typeof m.label === 'string' || m.label === null)) {
          options.onClientMessage?.({ type: 'favorite.rename', dir: m.dir, label: m.label })
        } else if (m.type === 'favorite.remove' && typeof m.dir === 'string') {
          options.onClientMessage?.({ type: 'favorite.remove', dir: m.dir })
        } else if (m.type === 'favorite.add' && typeof m.dir === 'string' && (m.label === undefined || m.label === null || typeof m.label === 'string')) {
          options.onClientMessage?.({ type: 'favorite.add', dir: m.dir, label: m.label })
        } else if (m.type === 'folder.pick' && typeof m.requestId === 'string' && m.requestId.length <= 64) {
          options.onClientMessage?.({ type: 'folder.pick', requestId: m.requestId })
        } else if (m.type === 'history.get' || m.type === 'timeline.get') {
          options.onClientMessage?.({ type: m.type })
        } else if (m.type === 'terminal.focusWindow' && typeof m.terminalId === 'string') {
          options.onClientMessage?.({ type: 'terminal.focusWindow', terminalId: m.terminalId })
        } else if (m.type === 'terminal.dismiss' && (m.terminalId === undefined || typeof m.terminalId === 'string')) {
          options.onClientMessage?.({ type: 'terminal.dismiss', terminalId: m.terminalId })
        } else if (m.type === 'favorite.open' && typeof m.dir === 'string' && (m.mode === 'new' || m.mode === 'continue')) {
          options.onClientMessage?.({ type: 'favorite.open', dir: m.dir, mode: m.mode })
        }
      } catch {
        return
      }
    })
    ws.on('close', () => clients.delete(ws))
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
