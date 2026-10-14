const MAX_FRAME = 64 * 1024 * 1024
const SEP = Buffer.from('\r\n\r\n')

export function encodeMessage(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

export class FrameError extends Error {}

/** `Content-Length` framed JSON (LSP style) from a byte stream. */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: unknown[] = []
    for (;;) {
      const sep = this.buf.indexOf(SEP)
      if (sep < 0) {
        if (this.buf.length > 8192) throw new FrameError('header too long')
        return out
      }
      const m = /Content-Length:\s*(\d+)/i.exec(this.buf.subarray(0, sep).toString('ascii'))
      if (!m) throw new FrameError('missing Content-Length')
      const len = Number(m[1])
      if (len > MAX_FRAME) throw new FrameError('frame too large')
      if (this.buf.length < sep + 4 + len) return out
      const body = this.buf.subarray(sep + 4, sep + 4 + len).toString('utf8')
      this.buf = this.buf.subarray(sep + 4 + len)
      try {
        out.push(JSON.parse(body))
      } catch {
        throw new FrameError('bad json')
      }
    }
  }
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class RpcClient {
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor(
    private readonly write: (buf: Buffer) => void,
    private readonly onNotify: (method: string, params: unknown) => void = () => undefined,
  ) {}

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.write(encodeMessage({ jsonrpc: '2.0', id, method, params }))
      } catch (err) {
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  handle(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return
    const m = msg as { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } }
    if (typeof m.method === 'string' && m.id === undefined) return this.onNotify(m.method, m.params)
    if (typeof m.id !== 'number') return
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.error) p.reject(new RpcError(typeof m.error.code === 'number' ? m.error.code : -32603, String(m.error.message ?? 'error')))
    else p.resolve(m.result)
  }

  failAll(err: Error): void {
    const all = [...this.pending.values()]
    this.pending.clear()
    for (const p of all) p.reject(err)
  }

  get size(): number {
    return this.pending.size
  }
}
