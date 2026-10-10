import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { LimitWindow, PlanLimits } from '@ccm/shared'

const FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i
const MAX_BYTES = 4096
const KEEP_MS = 7 * 24 * 3_600_000

export interface StatusLineRecord {
  sessionId: string
  at: string
  costUsd?: number
  contextWindow?: number
  /** Claude Code's own used percent of the full window. */
  contextPct?: number
  bufferPct?: number
  fiveHour?: LimitWindow
  sevenDay?: LimitWindow
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const pct = (v: unknown): number | undefined => {
  const n = num(v)
  return n !== undefined && n >= 0 && n <= 100 ? n : undefined
}

function windowOf(v: unknown): LimitWindow | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const w = v as { usedPct?: unknown; resetsAt?: unknown }
  const usedPct = num(w.usedPct)
  if (usedPct === undefined) return undefined
  const resetsAt = typeof w.resetsAt === 'string' && Number.isFinite(Date.parse(w.resetsAt)) ? w.resetsAt : undefined
  return { usedPct: Math.max(0, Math.min(100, usedPct)), resetsAt }
}

export function parseStatusLine(text: string): StatusLineRecord | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (typeof raw.sessionId !== 'string' || typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at))) return null
    const contextWindow = num(raw.contextWindow)
    return {
      sessionId: raw.sessionId,
      at: raw.at,
      costUsd: num(raw.costUsd),
      contextWindow: contextWindow !== undefined && contextWindow >= 1_000 && contextWindow <= 100_000_000 ? Math.round(contextWindow) : undefined,
      contextPct: pct(raw.contextPct),
      bufferPct: pct(raw.bufferPct),
      fiveHour: windowOf(raw.fiveHour),
      sevenDay: windowOf(raw.sevenDay),
    }
  } catch {
    return null
  }
}

/** Limits are account wide, so the newest report that carries them wins. */
export function latestLimits(records: StatusLineRecord[]): PlanLimits | null {
  let best: StatusLineRecord | null = null
  for (const r of records) if ((r.fiveHour || r.sevenDay) && (!best || r.at > best.at)) best = r
  return best ? { fiveHour: best.fiveHour, sevenDay: best.sevenDay, updatedAt: best.at } : null
}

/** Reads what `scripts/statusline-bridge.mjs` writes to `<dataDir>/statusline/`. */
export class StatusLineReader {
  private readonly cache = new Map<string, { mtimeMs: number; record: StatusLineRecord | null }>()

  constructor(private readonly dir: string) {}

  async read(now: number): Promise<StatusLineRecord[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      this.cache.clear()
      return []
    }
    const out: StatusLineRecord[] = []
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
          entry = { mtimeMs: st.mtimeMs, record: st.size <= MAX_BYTES ? parseStatusLine(await readFile(file, 'utf8')) : null }
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
