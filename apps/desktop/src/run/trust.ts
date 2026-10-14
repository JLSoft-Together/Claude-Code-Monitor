import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RunConfig } from '@ccm/shared'

export const TRUST_FILE = 'run-trust.json'
const MAX_HASHES = 500

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
  return v
}

/** Content hash of everything that decides what runs; any edit (command, args, env, beforeLaunch, cwd) asks again. */
export const configHash = (cfg: RunConfig): string => createHash('sha256').update(JSON.stringify(canonical(cfg))).digest('hex')

/** Approved config hashes in `<dataDir>/run-trust.json`, newest last. */
export class TrustStore {
  private cache: string[] | null = null

  constructor(private readonly dataDir: string) {}

  private file(): string {
    return path.join(this.dataDir, TRUST_FILE)
  }

  private async load(): Promise<string[]> {
    if (this.cache) return this.cache
    try {
      const raw = JSON.parse(await fs.readFile(this.file(), 'utf8')) as { hashes?: unknown }
      this.cache = Array.isArray(raw.hashes) ? raw.hashes.filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) : []
    } catch {
      this.cache = []
    }
    return this.cache
  }

  async has(hash: string): Promise<boolean> {
    return (await this.load()).includes(hash)
  }

  async add(hash: string): Promise<void> {
    const list = [...(await this.load()).filter((h) => h !== hash), hash].slice(-MAX_HASHES)
    this.cache = list
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
      await fs.writeFile(this.file() + '.tmp', JSON.stringify({ hashes: list }, null, 2))
      await fs.rename(this.file() + '.tmp', this.file())
    } catch {
      // read-only data dir: trusted for this app session only
    }
  }
}
