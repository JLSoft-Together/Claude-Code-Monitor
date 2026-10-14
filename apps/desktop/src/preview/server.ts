import { randomBytes } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { isWithin, realOrNull, rootKey, rootOf } from './paths'

export const MIME: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
  // Shown as text in the page; text/markdown would make Chromium download it.
  md: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
}

export const mimeOf = (file: string): string => MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'

export interface PreviewTarget {
  url: string
  root: string
  token: string
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  // Only pages from this server may embed these files; other local sites cannot hotlink them.
  'Cross-Origin-Resource-Policy': 'same-origin',
}

/** Serves registered folders at http://127.0.0.1:<port>/<token>/<rel>, one random token per folder. */
export class PreviewServer {
  private server: Server | null = null
  private port = 0
  private byToken = new Map<string, string>()
  private byRoot = new Map<string, string>()

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  get origin(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<number> {
    if (this.server) return this.port
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => this.send(res, 500))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = (server.address() as AddressInfo).port
    return this.port
  }

  close(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return Promise.resolve()
    server.closeAllConnections()
    return new Promise((resolve) => server.close(() => resolve()))
  }

  /** `root` must be a real path (realpath); the same folder always gets the same token. */
  register(root: string): string {
    const key = rootKey(root, this.platform)
    const known = this.byRoot.get(key)
    if (known) return known
    const token = randomBytes(16).toString('hex')
    this.byRoot.set(key, token)
    this.byToken.set(token, root)
    return token
  }

  rootOfToken(token: string): string | undefined {
    return this.byToken.get(token)
  }

  /** Tokens whose folder is `root` or lies inside it: the pages a change under `root` can affect. */
  tokensUnder(root: string): string[] {
    const out: string[] = []
    for (const [token, r] of this.byToken) if (isWithin(root, r, this.platform) || isWithin(r, root, this.platform)) out.push(token)
    return out
  }

  /** URL for a file or folder. Root = deepest of `roots` holding it, else the file's own folder. */
  async urlFor(target: string, roots: readonly string[] = []): Promise<PreviewTarget | null> {
    if (!this.server || !path.isAbsolute(target)) return null
    const real = await realOrNull(target)
    if (!real) return null
    const stat = await fs.stat(real).catch(() => null)
    if (!stat) return null
    const root = rootOf(real, roots, this.platform) ?? (stat.isDirectory() ? real : path.dirname(real))
    const token = this.register(root)
    const rel = path.relative(root, real).split(path.sep).filter(Boolean).map(encodeURIComponent).join('/')
    const tail = stat.isDirectory() ? (rel ? `${rel}/` : '') : rel
    return { url: `${this.origin}/${token}/${tail}`, root, token }
  }

  private send(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers })
    res.end(status >= 400 ? `${status}\n` : undefined)
  }

  private hostOk(host: string | undefined): boolean {
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.send(res, 405, { Allow: 'GET, HEAD' })
    // DNS rebinding guard: a page on another name that resolves here never gets an answer.
    if (!this.hostOk(req.headers.host)) return this.send(res, 403)
    const url = new URL(req.url ?? '/', this.origin)
    const [, token = '', ...rest] = url.pathname.split('/')
    const root = this.byToken.get(token)
    if (!root) return this.redirectFromReferer(req, res, url)

    let segments: string[]
    try {
      segments = rest.map(decodeURIComponent)
    } catch {
      return this.send(res, 400)
    }
    if (segments.some((s) => s.includes('\0') || s.includes('/') || s.includes('\\'))) return this.send(res, 404)
    const wanted = path.join(root, ...segments)
    if (!isWithin(root, wanted, this.platform)) return this.send(res, 404)
    let real = await realOrNull(wanted)
    if (!real || !isWithin(root, real, this.platform)) return this.send(res, 404)
    let stat = await fs.stat(real).catch(() => null)
    if (stat?.isDirectory()) {
      if (!url.pathname.endsWith('/')) return this.send(res, 301, { Location: `${url.pathname}/${url.search}` })
      real = await realOrNull(path.join(real, 'index.html'))
      if (!real || !isWithin(root, real, this.platform)) return this.send(res, 404)
      stat = await fs.stat(real).catch(() => null)
    }
    if (!stat?.isFile()) return this.send(res, 404)
    this.serveFile(req, res, real, stat.size)
  }

  // Root-relative asset paths ("/app.css") lose the token; the referring page tells us which folder they meant.
  private redirectFromReferer(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const referer = req.headers.referer
    if (!referer) return this.send(res, 404)
    let from: URL
    try {
      from = new URL(referer)
    } catch {
      return this.send(res, 404)
    }
    const refToken = from.pathname.split('/')[1] ?? ''
    if (from.origin !== this.origin || !this.byToken.has(refToken)) return this.send(res, 404)
    this.send(res, 307, { Location: `/${refToken}${url.pathname}${url.search}` })
  }

  private serveFile(req: IncomingMessage, res: ServerResponse, file: string, size: number): void {
    const headers: Record<string, string> = { ...BASE_HEADERS, 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes' }
    let start = 0
    let end = size - 1
    let status = 200
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start > end || start >= size) return this.send(res, 416, { 'Content-Range': `bytes */${size}` })
      status = 206
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    }
    headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
    res.writeHead(status, headers)
    if (req.method === 'HEAD' || size === 0) {
      res.end()
      return
    }
    const stream = createReadStream(file, { start, end })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }
}
