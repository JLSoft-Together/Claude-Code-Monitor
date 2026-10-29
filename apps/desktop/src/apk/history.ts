import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { rootKey } from '../preview/paths'
import type { ApkSnapshot } from './analyze'

export const APK_HISTORY_DIR = 'apk-history'
const HISTORY_MAX_BYTES = 64 * 1024 * 1024

interface Slots {
  last: ApkSnapshot
  prev: ApkSnapshot | null
}

const sameBuild = (a: ApkSnapshot, b: ApkSnapshot): boolean =>
  rootKey(a.report.path) === rootKey(b.report.path) && a.report.fileSize === b.report.fileSize && a.report.mtime === b.report.mtime

const isSnapshot = (v: unknown): v is ApkSnapshot => {
  const s = v as ApkSnapshot | null
  return !!s && typeof s === 'object' && !!s.report && typeof s.report.path === 'string' && Array.isArray(s.report.groups) && Array.isArray(s.files) && typeof s.analyzedAt === 'number'
}

/**
 * Last two builds analyzed per project (`<dataDir>/apk-history/<sha1(project)>.json`). A rebuild usually overwrites
 * the same app-release.apk, so the previous build is kept as a snapshot, not as a path.
 */
export class ApkHistory {
  constructor(private readonly dataDir: string) {}

  fileOf(project: string): string {
    return path.join(this.dataDir, APK_HISTORY_DIR, `${createHash('sha1').update(rootKey(project)).digest('hex')}.json`)
  }

  private async read(project: string): Promise<Slots | null> {
    try {
      const file = this.fileOf(project)
      if ((await fs.stat(file)).size > HISTORY_MAX_BYTES) return null
      const v = JSON.parse(await fs.readFile(file, 'utf8')) as Slots
      if (!isSnapshot(v?.last)) return null
      return { last: v.last, prev: isSnapshot(v.prev) ? v.prev : null }
    } catch {
      return null
    }
  }

  /** Records `snap` as the newest build and returns the one analyzed before it (if any). */
  async record(project: string, snap: ApkSnapshot): Promise<ApkSnapshot | null> {
    const cur = await this.read(project)
    let next: Slots
    if (!cur) next = { last: snap, prev: null }
    else if (sameBuild(cur.last, snap)) next = { last: { ...snap, analyzedAt: cur.last.analyzedAt }, prev: cur.prev }
    else next = { last: snap, prev: cur.last }
    const file = this.fileOf(project)
    try {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
      await fs.writeFile(tmp, JSON.stringify(next))
      await fs.rename(tmp, file)
    } catch {
      // history is a convenience: the analysis itself still answers
    }
    return next.prev
  }
}
