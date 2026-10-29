import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isLibName, LIBS_MAX, pickLatest, type LibCheckResult, type LibEco, type LibLookup, type LibLookupError, type LibQuery, type LibRegistry } from '@ccm/shared'
import { lookupUrl, parseMavenMetadata, parseNpmVersions, parsePubVersions, registriesFor } from './registry'

export const LIBS_CACHE_FILE = 'lib-versions-cache.json'
export const LIBS_TTL_MS = 60 * 60 * 1000
export const LIBS_TIMEOUT_MS = 10_000
export const LIBS_CONCURRENCY = 6
const CACHE_MAX = 3000
const BODY_MAX = 32 * 1024 * 1024

type FetchFn = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export interface LibCheckerDeps {
  fetch: FetchFn
  dataDir: string
  now?: () => number
  /** Loopback base replacing every registry (E2E), already validated. */
  override?: string
  timeoutMs?: number
}

interface CacheEntry {
  at: number
  registry: LibRegistry
  stable: string | null
  pre: string | null
}

const keyOf = (q: LibQuery): string => `${q.eco}:${q.name}`

/** Registry lookups on demand only (owner: network on click), cached for an hour in the data dir. */
export class LibChecker {
  private cache: Map<string, CacheEntry> | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly deps: LibCheckerDeps) {}

  private get file(): string {
    return path.join(this.deps.dataDir, LIBS_CACHE_FILE)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private async loadCache(): Promise<Map<string, CacheEntry>> {
    if (this.cache) return this.cache
    const map = new Map<string, CacheEntry>()
    try {
      const doc = JSON.parse(await fs.readFile(this.file, 'utf8')) as { entries?: Record<string, CacheEntry> }
      for (const [k, v] of Object.entries(doc.entries ?? {})) if (v && typeof v.at === 'number') map.set(k, v)
    } catch {
      /* missing or broken cache: start empty */
    }
    this.cache = map
    return map
  }

  private save(): Promise<void> {
    const map = this.cache
    if (!map) return this.saving
    const cutoff = this.now() - LIBS_TTL_MS
    for (const [k, v] of map) if (v.at < cutoff) map.delete(k)
    while (map.size > CACHE_MAX) map.delete(map.keys().next().value!)
    const body = JSON.stringify({ entries: Object.fromEntries(map) })
    this.saving = this.saving.then(async () => {
      try {
        await fs.mkdir(this.deps.dataDir, { recursive: true })
        const tmp = `${this.file}.tmp`
        await fs.writeFile(tmp, body)
        await fs.rename(tmp, this.file)
      } catch {
        /* cache is best effort */
      }
    })
    return this.saving
  }

  private async fetchText(url: string, eco: LibEco): Promise<{ text: string } | { status: number } | { error: 'network' | 'timeout' }> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.deps.timeoutMs ?? LIBS_TIMEOUT_MS)
    try {
      const headers: Record<string, string> = eco === 'npm' ? { accept: 'application/vnd.npm.install-v1+json' } : { accept: eco === 'pub' ? 'application/vnd.pub.v2+json' : 'application/xml' }
      const res = await this.deps.fetch(url, { signal: ctl.signal, headers })
      if (!res.ok) return { status: res.status }
      const text = await res.text()
      return text.length > BODY_MAX ? { status: 413 } : { text }
    } catch {
      return { error: ctl.signal.aborted ? 'timeout' : 'network' }
    } finally {
      clearTimeout(timer)
    }
  }

  private async lookup(q: LibQuery): Promise<LibLookup> {
    let lastError: LibLookupError = 'not-found'
    for (const registry of registriesFor(q.eco, q.name)) {
      const url = lookupUrl(registry, q.eco, q.name, this.deps.override)
      if (!url) return { ...q, ok: false, error: 'invalid' }
      const res = await this.fetchText(url, q.eco)
      if ('error' in res) return { ...q, ok: false, error: res.error }
      if ('status' in res) {
        lastError = res.status === 404 || res.status === 403 ? 'not-found' : 'bad-response'
        continue
      }
      const versions = q.eco === 'maven' ? parseMavenMetadata(res.text) : q.eco === 'pub' ? parsePubVersions(res.text) : parseNpmVersions(res.text)
      if (!versions) return { ...q, ok: false, error: 'bad-response' }
      const latest = pickLatest(versions)
      return { ...q, ok: true, registry, ...latest, checkedAt: this.now() }
    }
    return { ...q, ok: false, error: lastError }
  }

  async check(input: unknown, fresh = false): Promise<LibCheckResult> {
    if (!Array.isArray(input)) return { ok: false, error: 'invalid' }
    if (input.length > LIBS_MAX) return { ok: false, error: 'too-many' }
    const queries: LibQuery[] = []
    const seen = new Set<string>()
    for (const raw of input) {
      const q = raw as Partial<LibQuery> | null
      if (!q || !isLibName(q.eco, q.name)) return { ok: false, error: 'invalid' }
      const clean = { eco: q.eco as LibEco, name: q.name as string }
      if (seen.has(keyOf(clean))) continue
      seen.add(keyOf(clean))
      queries.push(clean)
    }
    const cache = await this.loadCache()
    const out = new Map<string, LibLookup>()
    const todo: LibQuery[] = []
    for (const q of queries) {
      const hit = cache.get(keyOf(q))
      if (!fresh && hit && this.now() - hit.at < LIBS_TTL_MS) out.set(keyOf(q), { ...q, ok: true, registry: hit.registry, stable: hit.stable, pre: hit.pre, checkedAt: hit.at })
      else todo.push(q)
    }
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const q = todo[next++]!
        const r = await this.lookup(q)
        out.set(keyOf(q), r)
        if (r.ok) cache.set(keyOf(q), { at: r.checkedAt, registry: r.registry, stable: r.stable, pre: r.pre })
      }
    }
    await Promise.all(Array.from({ length: Math.min(LIBS_CONCURRENCY, todo.length) }, worker))
    if (todo.length) await this.save()
    return { ok: true, results: queries.map((q) => out.get(keyOf(q))!) }
  }
}
