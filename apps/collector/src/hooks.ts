import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

export interface HookRecord {
  sessionId: string
  at: string
  compactingSince?: string
  compactTrigger?: 'manual' | 'auto'
  deniedCount: number
  deniedTools: string[]
}

const FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i
const TOOL_RE = /^[\w.:-]{1,80}$/
const MAX_BYTES = 4096
const KEEP_MS = 24 * 3_600_000
/** A PreCompact without its PostCompact (killed session) stops reading as "compacting" after this. */
export const COMPACT_STALE_MS = 15 * 60_000

const iso = (v: unknown): string | undefined => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : undefined)

export function parseHookRecord(text: string): HookRecord | null {
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  if (typeof r.sessionId !== 'string' || !FILE_RE.test(`${r.sessionId}.json`)) return null
  const at = iso(r.at)
  if (!at) return null
  const count = typeof r.deniedCount === 'number' && Number.isInteger(r.deniedCount) && r.deniedCount > 0 ? Math.min(r.deniedCount, 1_000_000) : 0
  const tools = Array.isArray(r.deniedTools) ? r.deniedTools.filter((t): t is string => typeof t === 'string' && TOOL_RE.test(t)).slice(-5) : []
  const since = iso(r.compactingSince)
  return {
    sessionId: r.sessionId,
    at,
    ...(since ? { compactingSince: since, compactTrigger: r.compactTrigger === 'manual' ? 'manual' : 'auto' } : {}),
    deniedCount: count,
    deniedTools: tools,
  }
}

/** Reads what `scripts/hook-bridge.mjs` writes to `<dataDir>/hooks/` (same cadence and caching as the status line reader). */
export class HookReader {
  private readonly cache = new Map<string, { mtimeMs: number; record: HookRecord | null }>()

  constructor(private readonly dir: string) {}

  async read(now: number): Promise<HookRecord[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      this.cache.clear()
      return []
    }
    const out: HookRecord[] = []
    const seen = new Set<string>()
    for (const name of names) {
      if (!FILE_RE.test(name)) continue
      const file = path.join(this.dir, name)
      try {
        const st = await stat(file)
        if (now - st.mtimeMs > KEEP_MS) {
          await unlink(file).catch(() => undefined)
          continue
        }
        seen.add(name)
        let entry = this.cache.get(name)
        if (!entry || entry.mtimeMs !== st.mtimeMs) {
          entry = { mtimeMs: st.mtimeMs, record: st.size <= MAX_BYTES ? parseHookRecord(await readFile(file, 'utf8')) : null }
          this.cache.set(name, entry)
        }
        if (entry.record) out.push(entry.record)
      } catch {
        continue
      }
    }
    for (const name of this.cache.keys()) if (!seen.has(name)) this.cache.delete(name)
    return out
  }
}
