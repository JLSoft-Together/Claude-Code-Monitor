import { promises as fs } from 'node:fs'
import path from 'node:path'
import { realOrNull, realRoots, rootOf } from './paths'

export const LOG_CHUNK_BYTES = 2 * 1024 * 1024
export const MAX_LOG_BYTES = 200 * 1024 * 1024

export type LogChunk =
  | { ok: true; path: string; text: string; start: number; end: number; size: number; mtimeMs: number; reset?: true }
  | { ok: false; error: 'denied' | 'missing' | 'too-large' | 'failed' }

export interface LogReadRequest {
  path?: unknown
  /** Read forward from this byte (follow); omitted = read backwards from `end`. */
  from?: unknown
  /** Backwards read ends here (exclusive); omitted = end of file. */
  end?: unknown
  bytes?: unknown
}

const offset = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null)

/**
 * One chunk of a log file inside `allowedRoots`, cut on line breaks so a chunk never starts or ends mid line
 * (and mid UTF-8 sequence). Backwards: `[end - bytes, end)` minus its partial first line. Forward (`from`): up to
 * the last complete line; a file shorter than `from` was truncated or rotated, so the tail comes back with `reset`.
 */
export async function readLogChunk(req: LogReadRequest, allowedRoots: readonly string[]): Promise<LogChunk> {
  const file = req?.path
  if (typeof file !== 'string' || !path.isAbsolute(file)) return { ok: false, error: 'denied' }
  const roots = await realRoots(allowedRoots)
  const real = await realOrNull(file)
  if (!real) return { ok: false, error: rootOf(path.resolve(file), roots) ? 'missing' : 'denied' }
  if (!rootOf(real, roots)) return { ok: false, error: 'denied' }
  const stat = await fs.stat(real).catch(() => null)
  if (!stat?.isFile()) return { ok: false, error: 'missing' }
  if (stat.size > MAX_LOG_BYTES) return { ok: false, error: 'too-large' }
  const size = stat.size
  const want = Math.min(LOG_CHUNK_BYTES, Math.max(1, offset(req.bytes) ?? LOG_CHUNK_BYTES))
  const from = offset(req.from)
  const forward = from !== null && from <= size
  let start: number
  let stop: number
  if (forward) {
    start = from
    stop = Math.min(size, from + want)
  } else {
    stop = Math.min(size, offset(req.end) ?? size)
    start = Math.max(0, stop - want)
  }
  const handle = await fs.open(real, 'r').catch(() => null)
  if (!handle) return { ok: false, error: 'failed' }
  try {
    const buf = Buffer.alloc(stop - start)
    const { bytesRead } = stop > start ? await handle.read(buf, 0, buf.length, start) : { bytesRead: 0 }
    let bytes = buf.subarray(0, bytesRead)
    stop = start + bytesRead
    if (forward) {
      const last = bytes.lastIndexOf(10)
      if (last >= 0) {
        bytes = bytes.subarray(0, last + 1)
        stop = start + last + 1
      } else if (bytesRead < want) {
        bytes = bytes.subarray(0, 0)
        stop = start
      }
    } else if (start > 0) {
      const first = bytes.indexOf(10)
      if (first >= 0 && first + 1 < bytes.length) {
        bytes = bytes.subarray(first + 1)
        start += first + 1
      }
    }
    const base = { ok: true as const, path: real, text: bytes.toString('utf8'), start, end: stop, size, mtimeMs: stat.mtimeMs }
    return from !== null && !forward ? { ...base, reset: true } : base
  } catch {
    return { ok: false, error: 'failed' }
  } finally {
    await handle.close().catch(() => undefined)
  }
}
