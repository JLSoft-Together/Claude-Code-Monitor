import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isCertSha256, type ReleaseMark, type ReleaseVersion } from '@ccm/shared'
import { rootKey } from '../preview/paths'

export const RELEASE_DIR = 'release-check'

export interface ReleaseMemory {
  released: ReleaseMark | null
  cert: { sha256: string; at: number } | null
}

const EMPTY: ReleaseMemory = { released: null, cert: null }

function clean(v: unknown): ReleaseMemory {
  const o = (v ?? {}) as Partial<ReleaseMemory>
  const r = o.released
  const released =
    r && typeof r === 'object' && typeof r.at === 'number' && (r.code === null || Number.isSafeInteger(r.code)) && (r.name === null || typeof r.name === 'string')
      ? { code: r.code, name: r.name === null ? null : r.name.slice(0, 64), at: r.at }
      : null
  const c = o.cert
  const cert = c && typeof c === 'object' && isCertSha256(c.sha256) && typeof c.at === 'number' ? { sha256: c.sha256, at: c.at } : null
  return { released, cert }
}

/** Per app dir: last version marked released + remembered release certificate (`<dataDir>/release-check/<sha1(dir)>.json`). */
export class ReleaseStore {
  constructor(private readonly dataDir: string) {}

  fileOf(appDir: string): string {
    return path.join(this.dataDir, RELEASE_DIR, `${createHash('sha1').update(rootKey(appDir)).digest('hex')}.json`)
  }

  async get(appDir: string): Promise<ReleaseMemory> {
    try {
      const file = this.fileOf(appDir)
      if ((await fs.stat(file)).size > 64 * 1024) return EMPTY
      return clean(JSON.parse(await fs.readFile(file, 'utf8')))
    } catch {
      return EMPTY
    }
  }

  private async write(appDir: string, next: ReleaseMemory): Promise<boolean> {
    const file = this.fileOf(appDir)
    try {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
      await fs.writeFile(tmp, JSON.stringify(next))
      await fs.rename(tmp, file)
      return true
    } catch {
      return false
    }
  }

  async markReleased(appDir: string, version: ReleaseVersion, now = Date.now()): Promise<boolean> {
    const cur = await this.get(appDir)
    return this.write(appDir, { ...cur, released: { code: version.code, name: version.name, at: now } })
  }

  async rememberCert(appDir: string, sha256: string, now = Date.now()): Promise<boolean> {
    if (!isCertSha256(sha256)) return false
    const cur = await this.get(appDir)
    return this.write(appDir, { ...cur, cert: { sha256, at: now } })
  }
}
