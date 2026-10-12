import { open, stat } from 'node:fs/promises'
import { classifyLine, metaOf, type CodexMeta } from './rollout'

const NEWLINE = 0x0a
const HEAD_BYTES = 256
const CHUNK = 4 * 1024 * 1024
const MAX_META_LINE = 4 * 1024 * 1024
/** A line still growing past this is dropped; nothing we parse comes close. */
const MAX_LINE = 32 * 1024 * 1024
const TIMESTAMP_RE = /"timestamp":"([^"]{10,40})"/
const EMPTY = Buffer.alloc(0)

const headOf = (buf: Buffer): string => buf.subarray(0, HEAD_BYTES).toString('utf8')

async function readRange(file: string, position: number, length: number): Promise<Buffer> {
  const handle = await open(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, position)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const JSON_FIELD = (name: string) => new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`)

function unescape(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return undefined
  }
}

/** Reads the `session_meta` line; when it is too long to parse whole, the fields come from its head. */
export async function readSessionMeta(file: string): Promise<CodexMeta | null> {
  let buf: Buffer
  try {
    buf = await readRange(file, 0, MAX_META_LINE)
  } catch {
    return null
  }
  const end = buf.indexOf(NEWLINE)
  if (end !== -1) {
    try {
      const rec = JSON.parse(buf.subarray(0, end).toString('utf8')) as { type?: unknown; payload?: unknown }
      return rec.type === 'session_meta' ? metaOf(rec.payload) : null
    } catch {
      return null
    }
  }
  const head = buf.subarray(0, 64 * 1024).toString('utf8')
  const payloadAt = head.indexOf('"payload":')
  if (!head.includes('"type":"session_meta"') || payloadAt === -1) return null
  const body = head.slice(payloadAt)
  const field = (name: string) => unescape(JSON_FIELD(name).exec(body)?.[1])
  return metaOf({
    id: field('id'),
    session_id: field('session_id'),
    timestamp: field('timestamp'),
    cwd: field('cwd'),
    originator: field('originator'),
    cli_version: field('cli_version'),
    source: field('source'),
  })
}

/**
 * Byte-offset tail of a rollout file that never buffers a line it is going to skip. Reading can start near the end
 * (`fromEnd`) because rollouts reach gigabytes; the partial first line is dropped.
 */
export class RolloutTailer {
  private offset = -1
  private remainder: Buffer = EMPTY
  private skipping = false
  private reading: Promise<unknown[]> | null = null

  constructor(
    readonly file: string,
    private readonly fromEnd = Number.POSITIVE_INFINITY,
  ) {}

  read(): Promise<unknown[]> {
    if (!this.reading) {
      this.reading = this.readNew().finally(() => {
        this.reading = null
      })
    }
    return this.reading
  }

  private async readNew(): Promise<unknown[]> {
    let size: number
    try {
      size = (await stat(this.file)).size
    } catch {
      return []
    }
    if (this.offset === -1) {
      this.offset = Math.max(0, size - this.fromEnd)
      this.skipping = this.offset > 0
    } else if (size < this.offset) {
      this.offset = 0
      this.remainder = EMPTY
      this.skipping = false
    }
    const out: unknown[] = []
    while (this.offset < size) {
      let chunk: Buffer
      try {
        chunk = await readRange(this.file, this.offset, Math.min(CHUNK, size - this.offset))
      } catch {
        break
      }
      if (chunk.length === 0) break
      this.offset += chunk.length
      this.consume(chunk, out)
    }
    return out
  }

  private consume(chunk: Buffer, out: unknown[]): void {
    let start = 0
    if (this.skipping) {
      const nl = chunk.indexOf(NEWLINE)
      if (nl === -1) return
      this.skipping = false
      start = nl + 1
    }
    let data = chunk.subarray(start)
    if (this.remainder.length) {
      data = Buffer.concat([this.remainder, data])
      this.remainder = EMPTY
    }
    let from = 0
    let idx: number
    while ((idx = data.indexOf(NEWLINE, from)) !== -1) {
      this.take(data.subarray(from, idx), out)
      from = idx + 1
    }
    const rest = data.subarray(from)
    const kind = rest.length >= HEAD_BYTES ? classifyLine(headOf(rest)) : 'parse'
    if (kind !== 'parse') {
      if (kind === 'compacted') this.take(rest.subarray(0, HEAD_BYTES), out)
      this.skipping = true
    } else if (rest.length > MAX_LINE) {
      this.skipping = true
    } else if (rest.length) {
      this.remainder = Buffer.from(rest)
    }
  }

  private take(line: Buffer, out: unknown[]): void {
    if (line.length === 0) return
    const head = headOf(line)
    const kind = classifyLine(head)
    if (kind === 'skip') return
    if (kind === 'compacted') {
      out.push({ type: 'compacted', timestamp: TIMESTAMP_RE.exec(head)?.[1], payload: {} })
      return
    }
    try {
      out.push(JSON.parse(line.toString('utf8')))
    } catch {
      return
    }
  }
}
