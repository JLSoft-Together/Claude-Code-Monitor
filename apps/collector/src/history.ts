import type { SessionRecord } from '@ccm/shared'
import { JsonFile } from './json-file'

export const HISTORY_LIMIT = 1000

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const str = (v: unknown): v is string => typeof v === 'string'

function parseRecord(v: unknown): SessionRecord | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  if (!str(r.id) || !str(r.title) || !str(r.endedAt) || !Number.isFinite(Date.parse(r.endedAt))) return null
  return {
    id: r.id,
    title: r.title,
    cwd: str(r.cwd) ? r.cwd : undefined,
    gitBranch: str(r.gitBranch) ? r.gitBranch : undefined,
    model: str(r.model) ? r.model : undefined,
    startedAt: str(r.startedAt) ? r.startedAt : undefined,
    endedAt: r.endedAt,
    inputTokens: num(r.inputTokens) ? r.inputTokens : 0,
    outputTokens: num(r.outputTokens) ? r.outputTokens : 0,
    cacheReadTokens: num(r.cacheReadTokens) ? r.cacheReadTokens : 0,
    subagents: num(r.subagents) ? r.subagents : 0,
    compactions: num(r.compactions) ? r.compactions : undefined,
    costUsd: num(r.costUsd) ? r.costUsd : undefined,
    workingMs: num(r.workingMs) ? r.workingMs : undefined,
    waitingMs: num(r.waitingMs) ? r.waitingMs : undefined,
  }
}

/** Ended sessions (newest first, capped); survives collector restarts and the stale-TTL removal from the dashboard. */
export class SessionHistory {
  private records: SessionRecord[] = []
  private readonly file: JsonFile | null

  constructor(file: string | null = null) {
    this.file = file ? new JsonFile(file, 10_000) : null
  }

  async load(): Promise<void> {
    const raw = await this.file?.read()
    if (!Array.isArray(raw)) return
    this.records = raw.map(parseRecord).filter((r): r is SessionRecord => r !== null).slice(0, HISTORY_LIMIT)
  }

  add(record: SessionRecord): void {
    this.records = [record, ...this.records.filter((r) => r.id !== record.id)].slice(0, HISTORY_LIMIT)
    this.file?.schedule(() => this.records)
  }

  list(): SessionRecord[] {
    return [...this.records]
  }

  save(): Promise<void> {
    return this.file?.flush(() => this.records) ?? Promise.resolve()
  }
}
