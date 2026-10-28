import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { rootKey } from './paths'

export const LH_MAX_BYTES = 2 * 1024 * 1024
export const LH_KEEP = 50
export const LH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const ID = /^(\d{13})(?:-(\d{1,3}))?$/

export interface LhVersion {
  id: string
  time: number
  size: number
}
export type LhList = { ok: true; versions: LhVersion[] } | { ok: false; error: 'denied' | 'failed' }
export type LhRead = { ok: true; text: string; time: number } | { ok: false; error: 'denied' | 'missing' | 'failed' }

export interface LocalHistoryDeps {
  now?: () => number
}

export const isVersionId = (id: unknown): id is string => typeof id === 'string' && ID.test(id)
const timeOf = (id: string): number => Number(ID.exec(id)?.[1] ?? 0)
const seqOf = (id: string): number => Number(ID.exec(id)?.[2] ?? 0)

/** IntelliJ-style Local History: the disk text before each save the app made, `<dataDir>/history/<sha1(path)>/<id>.txt`. */
export class LocalHistory {
  private readonly queue = new Map<string, Promise<unknown>>()
  private swept = false

  constructor(
    private readonly dataDir: string,
    private readonly deps: LocalHistoryDeps = {},
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  dirOf(file: string): string {
    return path.join(this.dataDir, 'history', createHash('sha1').update(rootKey(file)).digest('hex'))
  }

  /** `previous` = text on disk before a save of `file` (a real path). Too large or binary text is skipped. */
  record(file: string, previous: string): Promise<void> {
    if (previous.includes('\0') || Buffer.byteLength(previous, 'utf8') > LH_MAX_BYTES) return Promise.resolve()
    const key = rootKey(file)
    const run = (this.queue.get(key) ?? Promise.resolve()).then(() => this.recordNow(file, previous)).catch(() => undefined)
    this.queue.set(key, run)
    void run.then(() => {
      if (this.queue.get(key) === run) this.queue.delete(key)
    })
    return run
  }

  private async recordNow(file: string, previous: string): Promise<void> {
    const dir = this.dirOf(file)
    await fs.mkdir(dir, { recursive: true })
    const now = this.now()
    let id = String(now).padStart(13, '0')
    const names = new Set(await fs.readdir(dir).catch(() => [] as string[]))
    for (let n = 1; names.has(`${id}.txt`) && n < 1000; n++) id = `${String(now).padStart(13, '0')}-${n}`
    await fs.writeFile(path.join(dir, `${id}.txt`), previous, { encoding: 'utf8', flag: 'wx' })
    await this.prune(dir, now)
    if (!this.swept) {
      this.swept = true
      await this.sweep(now)
    }
  }

  private async ids(dir: string): Promise<string[]> {
    const names = await fs.readdir(dir).catch(() => [] as string[])
    return names
      .filter((n) => n.endsWith('.txt') && isVersionId(n.slice(0, -4)))
      .map((n) => n.slice(0, -4))
      .sort((a, b) => timeOf(b) - timeOf(a) || seqOf(b) - seqOf(a))
  }

  private async prune(dir: string, now: number): Promise<number> {
    const ids = await this.ids(dir)
    const drop = ids.filter((id, i) => i >= LH_KEEP || now - timeOf(id) > LH_MAX_AGE_MS)
    await Promise.all(drop.map((id) => fs.rm(path.join(dir, `${id}.txt`), { force: true }).catch(() => undefined)))
    return ids.length - drop.length
  }

  /** Once per app run: expired versions of files not saved since go too. */
  private async sweep(now: number): Promise<void> {
    const base = path.join(this.dataDir, 'history')
    const dirs = await fs.readdir(base).catch(() => [] as string[])
    for (const d of dirs) {
      if (!/^[0-9a-f]{40}$/.test(d)) continue
      const dir = path.join(base, d)
      if ((await this.prune(dir, now)) === 0) await fs.rmdir(dir).catch(() => undefined)
    }
  }

  async list(file: string): Promise<LhList> {
    const dir = this.dirOf(file)
    const now = this.now()
    const out: LhVersion[] = []
    for (const id of await this.ids(dir)) {
      if (now - timeOf(id) > LH_MAX_AGE_MS || out.length >= LH_KEEP) continue
      const stat = await fs.stat(path.join(dir, `${id}.txt`)).catch(() => null)
      if (stat?.isFile()) out.push({ id, time: timeOf(id), size: stat.size })
    }
    return { ok: true, versions: out }
  }

  async read(file: string, id: unknown): Promise<LhRead> {
    if (!isVersionId(id)) return { ok: false, error: 'denied' }
    const target = path.join(this.dirOf(file), `${id}.txt`)
    const stat = await fs.stat(target).catch(() => null)
    if (!stat?.isFile()) return { ok: false, error: 'missing' }
    if (stat.size > LH_MAX_BYTES) return { ok: false, error: 'failed' }
    const text = await fs.readFile(target, 'utf8').catch(() => null)
    return text === null ? { ok: false, error: 'failed' } : { ok: true, text, time: timeOf(id) }
  }
}
