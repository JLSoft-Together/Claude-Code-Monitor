import { open, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { BackgroundJob, JobState } from '@ccm/shared'

const JOB_ID_RE = /^[A-Za-z0-9_-]{4,64}$/
const MAX_STATE_BYTES = 256 * 1024
const TAIL_BYTES = 4096
const MAX_JOBS = 50
const DONE_KEEP_MS = 24 * 3_600_000
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATES =new Set<JobState>(['working', 'blocked', 'done'])

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const short = (v: unknown, max = 80): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined)
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const jobState = (v: unknown): JobState => (STATES.has(v as JobState) ? (v as JobState) : 'unknown')

/** Whitelist of `state.json`: never `intent`, `detail`, `output`, `linkScanPath`, `respawnFlags`, `children`. */
export function parseJobState(id: string, text: string): BackgroundJob | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(raw)) return null
  const inFlight = isObj(raw.inFlight) ? raw.inFlight : {}
  return {
    id,
    name: short(raw.name),
    state: jobState(raw.state),
    tempo: short(raw.tempo, 20),
    tasks: count(inFlight.tasks),
    queued: count(inFlight.queued),
    tokens: count(raw.tokens),
    sessionId: typeof raw.sessionId === 'string' && SESSION_RE.test(raw.sessionId) ? raw.sessionId : undefined,
  }
}

/** `at` of the newest timeline row whose state matches (only `at` and `state` are read). */
export function lastStateChange(tail: string, state: JobState): string | undefined {
  const lines = tail.split('\n').filter(Boolean).reverse()
  let since: string | undefined
  for (const line of lines) {
    try {
      const row: unknown = JSON.parse(line)
      if (!isObj(row) || typeof row.at !== 'string') continue
      if (row.state !== state) break
      since = row.at
    } catch {
      continue
    }
  }
  return since
}

async function readTail(file: string): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - TAIL_BYTES)
    const buf = Buffer.alloc(size - start)
    await handle.read(buf, 0, buf.length, start)
    const text = buf.toString('utf8')
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await handle.close()
  }
}

interface Cached {
  mtimeMs: number
  job: BackgroundJob
}

export class JobReader {
  private readonly cache = new Map<string, Cached>()

  constructor(private readonly jobsDir: string) {}

  async read(now: number): Promise<BackgroundJob[]> {
    let names: string[]
    try {
      names = await readdir(this.jobsDir)
    } catch {
      this.cache.clear()
      return []
    }
    const seen = new Set<string>()
    const jobs: BackgroundJob[] = []
    for (const id of names) {
      if (!JOB_ID_RE.test(id)) continue
      const job = await this.readOne(id)
      if (!job) continue
      seen.add(id)
      const updated = Date.parse(job.updatedAt ?? '')
      if (job.state === 'done' && Number.isFinite(updated) && now - updated > DONE_KEEP_MS) continue
      jobs.push(job)
    }
    for (const id of this.cache.keys()) if (!seen.has(id)) this.cache.delete(id)
    return jobs.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, MAX_JOBS)
  }

  private async readOne(id: string): Promise<BackgroundJob | null> {
    const dir = path.join(this.jobsDir, id)
    const stateFile = path.join(dir, 'state.json')
    try {
      const st = await stat(stateFile)
      const cached = this.cache.get(id)
      if (cached && cached.mtimeMs === st.mtimeMs) return cached.job
      if (st.size > MAX_STATE_BYTES) return null
      const job = parseJobState(id, await readFile(stateFile, 'utf8'))
      if (!job) return null
      job.updatedAt = new Date(st.mtimeMs).toISOString()
      try {
        job.stateSince = lastStateChange(await readTail(path.join(dir, 'timeline.jsonl')), job.state)
      } catch {
        job.stateSince = undefined
      }
      if (!job.stateSince && cached?.job.state === job.state) job.stateSince = cached.job.stateSince
      this.cache.set(id, { mtimeMs: st.mtimeMs, job })
      return job
    } catch {
      return null
    }
  }
}
