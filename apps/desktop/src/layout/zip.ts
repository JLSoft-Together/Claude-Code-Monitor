import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { inflateRaw as inflateRawCb } from 'node:zlib'

const inflateRaw = promisify(inflateRawCb)

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

export class ZipError extends Error {
  constructor(readonly code: 'zip-corrupt' | 'zip64' | 'zip-unsafe-path' | 'zip-too-large' | 'zip-method') {
    super(code)
  }
}

/** Entry names that would land outside the target (zip slip) or need special handling are refused. */
export function safeEntryName(name: string): string | null {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null
  const parts = name.split('/').filter(Boolean)
  if (!parts.length || parts.some((s) => s === '..' || s === '.')) return null
  return parts.join('/')
}

export function readCentralDirectory(buf: Buffer, fileSize: number): { entries: ZipEntry[] } {
  // EOCD sits in the last 22 + 65535 (comment) bytes; `buf` is that tail.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('zip-corrupt')
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('zip64')
  const tailStart = fileSize - buf.length
  const start = cdOffset - tailStart
  if (start < 0 || start + cdSize > buf.length) throw new ZipError('zip-corrupt')
  const entries: ZipEntry[] = []
  let at = start
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new ZipError('zip-corrupt')
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const compressedSize = buf.readUInt32LE(at + 20)
    const size = buf.readUInt32LE(at + 24)
    const localOffset = buf.readUInt32LE(at + 42)
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('zip64')
    entries.push({ name: buf.toString('utf8', at + 46, at + 46 + nameLen), method: buf.readUInt16LE(at + 10), compressedSize, size, localOffset })
    at += 46 + nameLen + extraLen + commentLen
  }
  return { entries }
}

/** Minimal jar/zip extractor (stored + deflate, no zip64): the layoutlib bundle needs nothing more and the app ships no zip dependency. */
export async function extractZip(
  file: string,
  dest: string,
  opts: { maxTotal: number; concurrency?: number; filter?: (name: string) => boolean },
): Promise<{ files: number; bytes: number }> {
  const fh = await fs.open(file, 'r')
  try {
    const { size: fileSize } = await fh.stat()
    const tailLen = Math.min(fileSize, 22 + 65535 + 4 * 1024 * 1024)
    const tail = Buffer.alloc(tailLen)
    await fh.read(tail, 0, tailLen, fileSize - tailLen)
    let entries: ZipEntry[]
    try {
      entries = readCentralDirectory(tail, fileSize).entries
    } catch (err) {
      // Central directory larger than the tail we read: read it whole.
      if (!(err instanceof ZipError) || err.code !== 'zip-corrupt' || tailLen === fileSize) throw err
      const all = Buffer.alloc(fileSize)
      await fh.read(all, 0, fileSize, 0)
      entries = readCentralDirectory(all, fileSize).entries
    }
    if (opts.filter) entries = entries.filter((e) => opts.filter!(e.name))
    const total = entries.reduce((n, e) => n + e.size, 0)
    if (total > opts.maxTotal) throw new ZipError('zip-too-large')
    const root = path.resolve(dest)
    let files = 0
    let bytes = 0
    const queue = entries.slice()
    const worker = async (): Promise<void> => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const name = safeEntryName(e.name)
        if (!name) throw new ZipError('zip-unsafe-path')
        const out = path.resolve(root, ...name.split('/'))
        if (!out.startsWith(root + path.sep)) throw new ZipError('zip-unsafe-path')
        if (e.name.endsWith('/')) {
          await fs.mkdir(out, { recursive: true })
          continue
        }
        if (e.method !== 0 && e.method !== 8) throw new ZipError('zip-method')
        const head = Buffer.alloc(30)
        await fh.read(head, 0, 30, e.localOffset)
        if (head.readUInt32LE(0) !== 0x04034b50) throw new ZipError('zip-corrupt')
        const dataAt = e.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
        if (dataAt + e.compressedSize > fileSize) throw new ZipError('zip-corrupt')
        const raw = Buffer.alloc(e.compressedSize)
        if (e.compressedSize) await fh.read(raw, 0, e.compressedSize, dataAt)
        const data = e.method === 8 ? await inflateRaw(raw, { maxOutputLength: Math.max(1, e.size) }) : raw
        if (data.length !== e.size) throw new ZipError('zip-corrupt')
        await fs.mkdir(path.dirname(out), { recursive: true })
        await fs.writeFile(out, data)
        files++
        bytes += data.length
      }
    }
    const stopOnError = (): Promise<void> =>
      worker().catch((err: unknown) => {
        queue.length = 0
        throw err
      })
    await Promise.all(Array.from({ length: opts.concurrency ?? 8 }, stopOnError))
    return { files, bytes }
  } finally {
    await fh.close()
  }
}
