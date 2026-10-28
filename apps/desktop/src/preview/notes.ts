import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { rootKey } from './paths'

export const NOTES_MAX_BYTES = 1024 * 1024
const RENAME_TRIES = 5

export type NoteRead = { ok: true; text: string; mtimeMs: number | null } | { ok: false; error: 'denied' | 'too-large' | 'failed' }
export type NoteWrite = { ok: true; mtimeMs: number | null } | { ok: false; error: 'denied' | 'too-large' | 'failed' }

export interface NotesDeps {
  rename?: (from: string, to: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
}

const isBusy = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

/** One markdown file per project under `<dataDir>/notes/`, named by the sha1 of the normalized root (outside the repo). */
export class NotesStore {
  private readonly queue = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dataDir: string,
    private readonly deps: NotesDeps = {},
  ) {}

  fileOf(root: string): string {
    return path.join(this.dataDir, 'notes', `${createHash('sha1').update(rootKey(root)).digest('hex')}.md`)
  }

  async read(root: string): Promise<NoteRead> {
    const file = this.fileOf(root)
    const stat = await fs.stat(file).catch((e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? null : e))
    if (stat === null) return { ok: true, text: '', mtimeMs: null }
    if (stat instanceof Error || !stat.isFile()) return { ok: false, error: 'failed' }
    if (stat.size > NOTES_MAX_BYTES) return { ok: false, error: 'too-large' }
    const text = await fs.readFile(file, 'utf8').catch(() => null)
    return text === null ? { ok: false, error: 'failed' } : { ok: true, text, mtimeMs: stat.mtimeMs }
  }

  /** Writes are queued per project; empty text removes the file. */
  write(root: string, text: unknown): Promise<NoteWrite> {
    if (typeof text !== 'string') return Promise.resolve({ ok: false, error: 'denied' })
    if (text.length > NOTES_MAX_BYTES || Buffer.byteLength(text, 'utf8') > NOTES_MAX_BYTES) return Promise.resolve({ ok: false, error: 'too-large' })
    const key = rootKey(root)
    const run = (this.queue.get(key) ?? Promise.resolve()).then(() => this.writeNow(root, text))
    const tail = run.catch(() => undefined)
    this.queue.set(key, tail)
    void tail.then(() => {
      if (this.queue.get(key) === tail) this.queue.delete(key)
    })
    return run
  }

  private async writeNow(root: string, text: string): Promise<NoteWrite> {
    const file = this.fileOf(root)
    try {
      if (!text) {
        await fs.rm(file, { force: true })
        return { ok: true, mtimeMs: null }
      }
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
      await fs.writeFile(temp, text, 'utf8')
      const rename = this.deps.rename ?? fs.rename
      const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
      for (let i = 0; ; i++) {
        try {
          await rename(temp, file)
          break
        } catch (e) {
          // Windows: an indexer or AV scanner holding the target makes rename fail for a moment.
          if (!isBusy(e) || i >= RENAME_TRIES - 1) {
            await fs.rm(temp, { force: true })
            return { ok: false, error: 'failed' }
          }
          await sleep(40 * (i + 1))
        }
      }
      return { ok: true, mtimeMs: (await fs.stat(file)).mtimeMs }
    } catch {
      return { ok: false, error: 'failed' }
    }
  }
}
