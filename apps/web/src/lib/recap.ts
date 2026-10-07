import { estimateCost, type DayTimeline, type LaneStatus, type ResponseStats, type SessionRecord, type UsageBucket } from '@ccm/shared'

export interface RecapRow {
  id: string
  tokens: number
  cost: number
}

export interface Recap {
  day: string
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number; messages: number }
  cost: number
  models: RecapRow[]
  projects: RecapRow[]
  /** Sessions that ended this day (collector history). */
  ended: SessionRecord[]
  /** Status time summed over every lane (only known for the collector's current day). */
  time: Record<LaneStatus, number> | null
  sessionsSeen: number | null
  response: ResponseStats | null
}

const localDay = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function top(map: Map<string, RecapRow>, n: number): RecapRow[] {
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens).slice(0, n)
}

export function buildRecap(input: {
  day: string
  buckets: UsageBucket[]
  projectOf: (dir: string) => string
  history: SessionRecord[]
  timeline: DayTimeline | null
  response: ResponseStats | null
  nowMs: number
}): Recap {
  const tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: 0 }
  const models = new Map<string, RecapRow>()
  const projects = new Map<string, RecapRow>()
  let cost = 0
  for (const b of input.buckets) {
    if (b.day !== input.day) continue
    const c = estimateCost(b, b.model, b.fast) ?? 0
    const tk = b.input + b.output + b.cacheWrite5m + b.cacheWrite1h
    tokens.input += b.input
    tokens.output += b.output
    tokens.cacheWrite += b.cacheWrite5m + b.cacheWrite1h
    tokens.cacheRead += b.cacheRead
    tokens.messages += b.messages
    cost += c
    for (const [map, id] of [
      [models, b.model],
      [projects, input.projectOf(b.project)],
    ] as const) {
      const row = map.get(id) ?? { id, tokens: 0, cost: 0 }
      row.tokens += tk
      row.cost += c
      map.set(id, row)
    }
  }
  const tl = input.timeline?.day === input.day ? input.timeline : null
  let time: Record<LaneStatus, number> | null = null
  if (tl) {
    time = { working: 0, waiting: 0, idle: 0 }
    for (const lane of tl.lanes)
      for (const s of lane.segments) time[s.status] += Math.max(0, (s.to ? Date.parse(s.to) : input.nowMs) - Date.parse(s.from))
  }
  return {
    day: input.day,
    tokens,
    cost,
    models: top(models, 8),
    projects: top(projects, 8),
    ended: input.history.filter((r) => localDay(r.endedAt) === input.day),
    time,
    sessionsSeen: tl ? tl.lanes.length : null,
    response: input.response?.day === input.day ? input.response : null,
  }
}

const csvCell = (v: string | number | undefined): string => {
  const s = v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per ended session; spreadsheet formula prefixes are neutralised. */
export function recapCsv(recap: Recap): string {
  const head = ['title', 'cwd', 'branch', 'model', 'started', 'ended', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'subagents', 'compactions', 'cost_usd', 'working_min', 'waiting_min']
  const safe = (s: string | undefined) => (s && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s)
  const min = (ms: number | undefined) => (ms === undefined ? undefined : Math.round(ms / 60_000))
  const rows = recap.ended.map((r) =>
    [
      safe(r.title),
      safe(r.cwd),
      safe(r.gitBranch),
      safe(r.model),
      safe(r.startedAt),
      safe(r.endedAt),
      r.inputTokens,
      r.outputTokens,
      r.cacheReadTokens,
      r.subagents,
      r.compactions,
      r.costUsd?.toFixed(4),
      min(r.workingMs),
      min(r.waitingMs),
    ]
      .map(csvCell)
      .join(','),
  )
  return [head.join(','), ...rows].join('\r\n')
}

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
