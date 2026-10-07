import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ServerMessage } from '@ccm/shared'
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

export function isLocalRequest(req: IncomingMessage): boolean {
  const host = hostOf(req.headers.host)
  if (!host || !LOCAL_HOSTS.has(host)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  const originHost = hostOf(origin)
  return originHost !== null && LOCAL_HOSTS.has(originHost)
}

async function serveStatic(webDist: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const root = path.resolve(webDist)
  let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`)
  if (!file.startsWith(root)) {
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
    'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  createReadStream(file).pipe(res)
}

export function startServer(options: {
  host: string
  port: number
  webDist: string
  store: MonitorStore
}): Promise<Server> {
  const { store } = options
  const server = createServer((req, res) => {
    if (!isLocalRequest(req)) {
      res.writeHead(403).end()
      return
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, seq: store.seq }))
      return
    }
    void serveStatic(options.webDist, req, res)
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })
  const clients = new Set<WebSocket>()

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/ws' || !isLocalRequest(req)) {
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
    send(ws, store.snapshotMessage())
    ws.on('message', (data) => {
      try {
        const msg: unknown = JSON.parse(String(data))
        if (typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'resync') {
          send(ws, store.snapshotMessage())
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
