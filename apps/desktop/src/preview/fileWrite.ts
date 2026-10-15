import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { decodeUtf8, eolOf, hasUtf8Bom, type Eol } from './files'
import { realOrNull, rootOf } from './paths'

/** Room above the 2 MB view limit for a file that grew while edited. */
export const MAX_WRITE_BYTES = 4 * 1024 * 1024
const SNIFF_BYTES = 8 * 1024
const RENAME_TRIES = 6

export type FileWriteError = 'denied' | 'missing' | 'conflict' | 'too-large' | 'encoding' | 'busy' | 'failed'
export type FileWriteResult = { ok: true; path: string; mtimeMs: number; size: number } | { ok: false; error: FileWriteError }

export interface FileWriteDeps {
  rename?: (from: string, to: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
}

const EOL: Record<Eol, string> = { lf: '\n', crlf: '\r\n', cr: '\r' }

/** Editor text (any line breaks) → the bytes to store: the file's own EOL style and BOM. */
export function encodeForDisk(text: string, eol: Eol, bom: boolean): Buffer {
  const body = Buffer.from(text.replace(/\r\n|\r|\n/g, EOL[eol]), 'utf8')
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}

const isBusy = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

/**
 * Saves an existing text file the page edited. The real path (symlinks resolved) must sit inside one of `roots`
 * (already real paths), so a link pointing out of the project is refused. Atomic: temp file next to it + rename.
 */
export async function writeTextFile(req: unknown, roots: readonly string[], deps: FileWriteDeps = {}): Promise<FileWriteResult> {
  const r = (req ?? {}) as Record<string, unknown>
  const file = r.path
  const text = r.text
  if (typeof file !== 'string' || !path.isAbsolute(file) || typeof text !== 'string') return { ok: false, error: 'denied' }
  if (text.length > MAX_WRITE_BYTES || Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) return { ok: false, error: 'too-large' }
  const real = await realOrNull(file)
  if (!real) return { ok: false, error: rootOf(path.resolve(file), roots) ? 'missing' : 'denied' }
  if (!rootOf(real, roots)) return { ok: false, error: 'denied' }
  const stat = await fs.stat(real).catch(() => null)
  if (!stat?.isFile()) return { ok: false, error: 'missing' }
  const expected = r.expectedMtime
  // mtimeMs is a float on most filesystems; IPC keeps it exact, the tolerance only absorbs rounding.
  if (typeof expected === 'number' && Math.abs(stat.mtimeMs - expected) > 0.5) return { ok: false, error: 'conflict' }
  if (stat.size > MAX_WRITE_BYTES) return { ok: false, error: 'too-large' }
  const current = await fs.readFile(real).catch(() => null)
  if (!current) return { ok: false, error: 'missing' }
  if (current.subarray(0, SNIFF_BYTES).includes(0)) return { ok: false, error: 'encoding' }
  const decoded = decodeUtf8(current)
  if (decoded === null) return { ok: false, error: 'encoding' }
  const bytes = encodeForDisk(text, eolOf(decoded), hasUtf8Bom(current))

  const dir = path.dirname(real)
  const temp = path.join(dir, `.${path.basename(real)}.${randomBytes(4).toString('hex')}.ccm-tmp`)
  const rename = deps.rename ?? fs.rename
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)))
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx', mode: stat.mode & 0o777 })
  } catch (err) {
    return { ok: false, error: isBusy(err) ? 'denied' : 'failed' }
  }
  // Windows: an indexer / antivirus / watcher briefly holding the target makes rename fail with EPERM.
  for (let i = 0; ; i++) {
    try {
      await rename(temp, real)
      break
    } catch (err) {
      if (isBusy(err) && i < RENAME_TRIES - 1) {
        await sleep(40 * (i + 1))
        continue
      }
      await fs.rm(temp, { force: true }).catch(() => undefined)
      return { ok: false, error: isBusy(err) ? 'busy' : 'failed' }
    }
  }
  const after = await fs.stat(real).catch(() => null)
  return { ok: true, path: real, mtimeMs: after?.mtimeMs ?? Date.now(), size: after?.size ?? bytes.length }
}
