import { createReadStream, type Stats } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolStatEntry, ToolStats, UsageBucket, UsageHeatmap, UsageScan, UsageSnapshot, UsageTotals } from '@ccm/shared'

export interface UsageSink {
  resetUsage(snapshot: UsageSnapshot): void
  updateUsage(buckets: UsageBucket[]): void
  setUsageScan(scan: UsageScan): void
}

interface FileEntry {
  size: number
  offset: number
  mtimeMs?: number
  ids: string[]
  buckets: Record<string, UsageTotals>
  /** Assistant messages per `day|hour` (local), for the History heatmap. */
  hours?: Record<string, number>
  /** Calls per `day|kind|name|project` (see `ToolKind`), names only. */
  tools?: Record<string, number>
  gone?: boolean
}

/** t tool, m MCP server, s skill, a subagent type, e tool error, f MCP server error. */
export type ToolKind = 't' | 'm' | 's' | 'a' | 'e' | 'f'

export interface ToolCall {
  kind: 't' | 'm' | 's' | 'a'
  name: string
}

interface CacheFile {
  version: number
  files: Record<string, FileEntry>
}

export interface UsageRecord {
  key: string
  day: string
  model: string
  project: string
  fast: boolean
  messageId: string
  /** Local hour 0–23 of the message. */
  hour: number
  totals: UsageTotals
}

const CACHE_VERSION = 4
const NEWLINE = 0x0a
const IS_ERROR = Buffer.from('"is_error":true')
const NAME_MAX = 100
/** Open tool_use ids kept per transcript to pair an error result; results land within a few lines of their call. */
const OPEN_TOOLS_MAX = 500
const TOOL_KEY_RE = /^\d{4}-\d{2}-\d{2}\|[tmsaef]\|[^|]+\|.*$/
const AGENT_TOOLS = new Set(['Agent', 'Task'])
const STAT_BATCH = 32
const DAY_MS = 86_400_000
/** Resume/fork of a transcript older than this is rare; dropping its ids keeps the cache from growing forever. */
const ID_RETENTION_MS = 30 * DAY_MS
const RENAME_RETRIES = 5

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function statAll(dir: string, files: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>()
  for (let i = 0; i < files.length; i += STAT_BATCH) {
    const batch = files.slice(i, i + STAT_BATCH)
    const stats = await Promise.all(batch.map((rel) => stat(path.join(dir, rel)).catch(() => null)))
    batch.forEach((rel, j) => {
      const st = stats[j]
      if (st) out.set(rel, st)
    })
  }
  return out
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // Antivirus / indexer briefly locks the target on Windows.
      if (attempt >= RENAME_RETRIES || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await sleep(100 * attempt)
    }
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

export const emptyTotals = (): UsageTotals => ({ messages: 0, input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 })

function addInto(target: UsageTotals, src: UsageTotals, sign = 1): void {
  target.messages += sign * src.messages
  target.input += sign * src.input
  target.output += sign * src.output
  target.cacheWrite5m += sign * src.cacheWrite5m
  target.cacheWrite1h += sign * src.cacheWrite1h
  target.cacheRead += sign * src.cacheRead
}

export function localDay(iso: string): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const bucketKey = (day: string, model: string, project: string, fast: boolean): string =>
  `${day}|${model}|${project}|${fast ? 'f' : 's'}`

export function parseBucketKey(key: string): Pick<UsageBucket, 'day' | 'model' | 'project' | 'fast'> {
  const [day = '', model = '', ...rest] = key.split('|')
  const speed = rest.pop()
  return { day, model, project: rest.join('|'), fast: speed === 'f' ? true : undefined }
}

/** Reads only ids, model, timestamp, cwd and usage counters — never message content. */
export function usageRecordOf(rec: unknown, fallbackProject: string): UsageRecord | null {
  if (!isObj(rec) || rec.type !== 'assistant' || !isObj(rec.message)) return null
  const msg = rec.message
  const model = typeof msg.model === 'string' ? msg.model : undefined
  const id = typeof msg.id === 'string' ? msg.id : undefined
  if (!model || model === '<synthetic>' || !id || !isObj(msg.usage)) return null
  const day = typeof rec.timestamp === 'string' ? localDay(rec.timestamp) : null
  if (!day) return null
  const hour = new Date(Date.parse(rec.timestamp as string)).getHours()
  const u = msg.usage
  const creation = int(u.cache_creation_input_tokens)
  const split = isObj(u.cache_creation) ? u.cache_creation : null
  const write1h = split ? int(split.ephemeral_1h_input_tokens) : 0
  const write5m = split ? int(split.ephemeral_5m_input_tokens) || Math.max(0, creation - write1h) : creation
  const project = typeof rec.cwd === 'string' && rec.cwd ? rec.cwd : fallbackProject
  const fast = u.speed === 'fast'
  return {
    key: bucketKey(day, model, project, fast),
    day,
    model,
    project,
    fast,
    messageId: id,
    hour,
    totals: {
      messages: 1,
      input: int(u.input_tokens),
      output: int(u.output_tokens),
      cacheWrite5m: write5m,
      cacheWrite1h: write1h,
      cacheRead: int(u.cache_read_input_tokens),
    },
  }
}

const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/[|\u0000-\u001f]/g, '').trim().slice(0, NAME_MAX)
  return s || null
}

/** `mcp__<server>__<tool>` → server. */
export function mcpServerOf(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const end = tool.indexOf('__', 5)
  return end > 5 ? tool.slice(5, end) : null
}

/** What one tool_use block counts as. Reads `name`, `input.skill` and `input.subagent_type` only, never other input. */
export function toolCallsOf(block: unknown): ToolCall[] {
  if (!isObj(block) || block.type !== 'tool_use') return []
  const name = cleanName(block.name)
  if (!name) return []
  const server = mcpServerOf(name)
  if (server) return [{ kind: 'm', name: server }]
  const out: ToolCall[] = [{ kind: 't', name }]
  const input = isObj(block.input) ? block.input : {}
  if (name === 'Skill') {
    const skill = cleanName(input.skill)
    if (skill) out.push({ kind: 's', name: skill })
  } else if (AGENT_TOOLS.has(name)) {
    // Claude Code runs `general-purpose` when the call names no type.
    out.push({ kind: 'a', name: cleanName(input.subagent_type) ?? 'general-purpose' })
  }
  return out
}

export const toolKey = (day: string, kind: ToolKind, name: string, project: string): string => `${day}|${kind}|${name}|${project}`

function lastDays(days: number, today: string): string[] {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(localDay(new Date(y, m - 1, d - i, 12).toISOString())!)
  return out
}

async function listJsonl(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await listJsonl(full, base, out)
    else if (e.name.endsWith('.jsonl')) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

export class UsageIndex {
  private readonly files = new Map<string, FileEntry>()
  /** message.id → owning file. `--resume` / fork copies old messages into a new transcript, so dedupe must be global. */
  private readonly owners = new Map<string, string>()
  private readonly totals = new Map<string, UsageBucket>()
  private readonly hourTotals = new Map<string, number>()
  private readonly toolTotals = new Map<string, number>()
  /** Per transcript: tool_use id → error key, so an `is_error` result counts against its tool. Memory only. */
  private readonly openTools = new Map<string, Map<string, string>>()
  private readonly dirty = new Set<string>()
  private readonly pendingFiles = new Set<string>()
  private readonly fileTimers = new Map<string, NodeJS.Timeout>()
  private scan: UsageScan = { state: 'idle', filesDone: 0, filesTotal: 0 }
  private chain: Promise<void> = Promise.resolve()
  private sweepTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private saveNeeded = false
  private saving: Promise<void> | null = null
  private stopped = false

  constructor(
    private readonly projectsDir: string,
    private readonly cacheFile: string | null,
    private readonly sink: UsageSink,
    private readonly options: {
      sweepMs?: number
      fileDebounceMs?: number
      saveDebounceMs?: number
      idRetentionMs?: number
      now?: () => number
    } = {},
  ) {}

  scanInfo(): UsageScan {
    return { ...this.scan }
  }

  snapshot(): UsageSnapshot {
    return { buckets: [...this.totals.values()], scan: { ...this.scan } }
  }

  async start(): Promise<void> {
    await this.loadCache()
    this.sink.resetUsage(this.snapshot())
    void this.enqueue(() => this.fullScan())
    const sweepMs = this.options.sweepMs ?? 600_000
    if (sweepMs > 0) this.sweepTimer = setInterval(() => void this.enqueue(() => this.sweep()), sweepMs)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    for (const t of this.fileTimers.values()) clearTimeout(t)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    // Not awaiting the scan chain: a first scan can outlast the host's kill deadline; offsets saved so far resume it.
    await this.saving
    await this.save()
  }

  /** Called by the projects watcher with a path relative to the projects dir. */
  notify(file: string): void {
    if (this.stopped || !file.endsWith('.jsonl')) return
    const rel = file.split(path.sep).join('/')
    if (this.fileTimers.has(rel)) return
    this.fileTimers.set(
      rel,
      setTimeout(() => {
        this.fileTimers.delete(rel)
        this.pendingFiles.add(rel)
        void this.enqueue(() => this.drainPending())
      }, this.options.fileDebounceMs ?? 1_000),
    )
  }

  whenIdle(): Promise<void> {
    return this.chain
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(job).catch((err: unknown) => {
      console.error('[collector] usage index:', (err as Error).message)
    })
    return this.chain
  }

  private async fullScan(): Promise<void> {
    const files = await listJsonl(this.projectsDir)
    this.markGone(files)
    this.scan = { state: 'scanning', filesDone: 0, filesTotal: files.length }
    this.sink.setUsageScan({ ...this.scan })
    const stats = await statAll(this.projectsDir, files)
    let lastReport = Date.now()
    for (const rel of files) {
      if (this.stopped) return
      await this.ingest(rel, stats.get(rel))
      this.scan.filesDone++
      if (Date.now() - lastReport > 400) {
        lastReport = Date.now()
        this.sink.setUsageScan({ ...this.scan })
      }
    }
    this.scan = { state: 'ready', filesDone: files.length, filesTotal: files.length }
    this.dirty.clear()
    this.pruneOldIds()
    this.sink.resetUsage(this.snapshot())
    this.saveNow()
  }

  private async sweep(): Promise<void> {
    if (this.scan.state !== 'ready') return
    const files = await listJsonl(this.projectsDir)
    this.markGone(files)
    const stats = await statAll(this.projectsDir, files)
    for (const [rel, st] of stats) {
      const entry = this.files.get(rel)
      if (!entry || entry.gone || entry.size !== st.size || entry.mtimeMs !== st.mtimeMs) await this.ingest(rel, st)
    }
    this.pruneOldIds()
    this.flushDirty()
  }

  private pruneOldIds(): void {
    const cutoff = (this.options.now?.() ?? Date.now()) - (this.options.idRetentionMs ?? ID_RETENTION_MS)
    for (const [rel, entry] of this.files) {
      if (entry.ids.length === 0 || entry.mtimeMs === undefined || entry.mtimeMs >= cutoff) continue
      this.releaseIds(rel, entry)
      this.saveNeeded = true
    }
  }

  /** Deleted transcripts keep their buckets (history) but release their ids — nothing can copy from them any more. */
  private markGone(present: string[]): void {
    const live = new Set(present)
    for (const [rel, entry] of this.files) {
      if (entry.gone || live.has(rel)) continue
      entry.gone = true
      this.releaseIds(rel, entry)
      this.saveNeeded = true
    }
  }

  private releaseIds(rel: string, entry: FileEntry): void {
    for (const id of entry.ids) if (this.owners.get(id) === rel) this.owners.delete(id)
    entry.ids = []
  }

  private async drainPending(): Promise<void> {
    const files = [...this.pendingFiles]
    this.pendingFiles.clear()
    for (const rel of files) await this.ingest(rel)
    if (this.scan.state === 'ready') this.flushDirty()
  }

  private flushDirty(): void {
    if (this.dirty.size === 0) return
    const changed: UsageBucket[] = []
    for (const key of this.dirty) {
      const b = this.totals.get(key)
      if (b) changed.push({ ...b })
    }
    this.dirty.clear()
    this.sink.updateUsage(changed)
    this.scheduleSave()
  }

  private async ingest(rel: string, known?: Stats): Promise<void> {
    const full = path.join(this.projectsDir, rel)
    let st: Stats
    try {
      st = known ?? (await stat(full))
    } catch {
      return
    }
    const size = st.size
    let entry = this.files.get(rel)
    if (!entry) {
      entry = { size: 0, offset: 0, ids: [], buckets: {} }
      this.files.set(rel, entry)
    }
    if (entry.gone) {
      this.resetFile(rel, entry)
      delete entry.gone
    }
    if (size < entry.offset) this.resetFile(rel, entry)
    entry.size = size
    if (entry.mtimeMs !== st.mtimeMs) {
      entry.mtimeMs = st.mtimeMs
      this.saveNeeded = true
    }
    if (size === entry.offset) return

    const fallbackProject = rel.split('/')[0] ?? rel
    let consumed = 0
    let remainder: Buffer = Buffer.alloc(0)
    const stream = createReadStream(full, { start: entry.offset, end: size - 1 })
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const data = remainder.length ? Buffer.concat([remainder, chunk]) : chunk
      let start = 0
      let idx: number
      while ((idx = data.indexOf(NEWLINE, start)) !== -1) {
        const line = data.subarray(start, idx)
        start = idx + 1
        consumed += line.length + 1
        this.ingestLine(line, rel, fallbackProject, entry)
      }
      remainder = Buffer.from(data.subarray(start))
    }
    entry.offset += consumed
  }

  private ingestLine(line: Buffer, rel: string, fallbackProject: string, entry: FileEntry): void {
    const hasUsage = line.indexOf('"usage"') !== -1
    const hasError = line.indexOf(IS_ERROR) !== -1
    if (!hasUsage && !hasError) return
    let rec: unknown
    try {
      rec = JSON.parse(line.toString('utf8'))
    } catch {
      return
    }
    if (hasError && isObj(rec) && rec.type === 'user') return this.ingestErrors(rec, rel, entry)
    const r = usageRecordOf(rec, fallbackProject)
    if (!r) return
    const owner = this.owners.get(r.messageId)
    if (owner === undefined) {
      this.owners.set(r.messageId, rel)
      entry.ids.push(r.messageId)
      addInto((entry.buckets[r.key] ??= emptyTotals()), r.totals)
      this.addTotal(r.key, r.totals, 1)
      const hk = `${r.day}|${r.hour}`
      ;(entry.hours ??= {})[hk] = (entry.hours[hk] ?? 0) + 1
      this.addHour(hk, 1)
    } else if (owner !== rel) return
    // Claude Code writes one line per content block with the same message id: later blocks still carry tool calls.
    this.ingestTools(rec as Obj, r, rel, entry)
  }

  private ingestTools(rec: Obj, r: UsageRecord, rel: string, entry: FileEntry): void {
    const content = isObj(rec.message) ? rec.message.content : undefined
    if (!Array.isArray(content)) return
    for (const block of content) {
      const calls = toolCallsOf(block)
      if (!calls.length) continue
      for (const c of calls) this.countTool(entry, toolKey(r.day, c.kind, c.name, r.project), 1)
      const id = (block as Obj).id
      const head = calls[0]!
      if (typeof id !== 'string' || id.length > 200) continue
      let open = this.openTools.get(rel)
      if (!open) this.openTools.set(rel, (open = new Map()))
      open.set(id, toolKey(r.day, head.kind === 'm' ? 'f' : 'e', head.name, r.project))
      if (open.size > OPEN_TOOLS_MAX) open.delete(open.keys().next().value!)
    }
  }

  private ingestErrors(rec: Obj, rel: string, entry: FileEntry): void {
    const open = this.openTools.get(rel)
    const content = isObj(rec.message) ? rec.message.content : undefined
    if (!open || !Array.isArray(content)) return
    for (const b of content) {
      if (!isObj(b) || b.type !== 'tool_result' || b.is_error !== true || typeof b.tool_use_id !== 'string') continue
      const key = open.get(b.tool_use_id)
      if (!key) continue
      open.delete(b.tool_use_id)
      this.countTool(entry, key, 1)
    }
  }

  private countTool(entry: FileEntry, key: string, n: number): void {
    ;(entry.tools ??= {})[key] = (entry.tools[key] ?? 0) + n
    this.addTool(key, n)
  }

  private resetFile(rel: string, entry: FileEntry): void {
    for (const [key, totals] of Object.entries(entry.buckets)) this.addTotal(key, totals, -1)
    for (const [key, n] of Object.entries(entry.hours ?? {})) this.addHour(key, -n)
    for (const [key, n] of Object.entries(entry.tools ?? {})) this.addTool(key, -n)
    this.releaseIds(rel, entry)
    this.openTools.delete(rel)
    entry.buckets = {}
    delete entry.hours
    delete entry.tools
    entry.offset = 0
  }

  private addTotal(key: string, totals: UsageTotals, sign: number): void {
    let bucket = this.totals.get(key)
    if (!bucket) {
      bucket = { key, ...parseBucketKey(key), ...emptyTotals() }
      if (bucket.fast === undefined) delete bucket.fast
      this.totals.set(key, bucket)
    }
    addInto(bucket, totals, sign)
    this.dirty.add(key)
  }

  private addHour(key: string, n: number): void {
    const v = (this.hourTotals.get(key) ?? 0) + n
    if (v > 0) this.hourTotals.set(key, v)
    else this.hourTotals.delete(key)
  }

  private addTool(key: string, n: number): void {
    const v = (this.toolTotals.get(key) ?? 0) + n
    if (v > 0) this.toolTotals.set(key, v)
    else this.toolTotals.delete(key)
  }

  private today(): string {
    return localDay(new Date(this.options.now?.() ?? Date.now()).toISOString())!
  }

  /** Messages per local hour for the last `days` days (oldest first), computed on request only. */
  heatmap(days: number, today = this.today()): UsageHeatmap {
    return { days: lastDays(days, today).map((day) => ({ day, hours: Array.from({ length: 24 }, (_, h) => this.hourTotals.get(`${day}|${h}`) ?? 0) })) }
  }

  /** Call counts for the last `days` days, one project folder or all; computed on request only. */
  toolStats(days: number, project: string | null, today = this.today()): ToolStats {
    const month = new Set(lastDays(30, today))
    const window = new Set(lastDays(days, today))
    const perProject = new Map<string, number>()
    const sums: Record<ToolKind, Map<string, number>> = { t: new Map(), m: new Map(), s: new Map(), a: new Map(), e: new Map(), f: new Map() }
    const used = { s: new Set<string>(), m: new Set<string>() }
    for (const [key, n] of this.toolTotals) {
      const [day = '', kind = '', name = '', ...rest] = key.split('|')
      if (!month.has(day) || !(kind in sums)) continue
      const proj = rest.join('|')
      if (kind === 't' || kind === 'm') perProject.set(proj, (perProject.get(proj) ?? 0) + n)
      if (project !== null && proj !== project) continue
      if (kind === 's' || kind === 'm') used[kind].add(name)
      if (!window.has(day)) continue
      const sum = sums[kind as ToolKind]
      sum.set(name, (sum.get(name) ?? 0) + n)
    }
    const list = (kind: ToolKind, errorKind?: ToolKind): ToolStatEntry[] =>
      [...sums[kind]]
        .map(([name, n]) => (errorKind ? { name, n, errors: sums[errorKind].get(name) ?? 0 } : { name, n }))
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
        .slice(0, 50)
    return {
      days,
      project,
      projects: [...perProject].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([p]) => p),
      tools: list('t', 'e'),
      skills: list('s'),
      agents: list('a'),
      mcp: list('m', 'f'),
      used30: { skills: [...used.s].sort(), mcp: [...used.m].sort() },
    }
  }

  private async loadCache(): Promise<void> {
    if (!this.cacheFile) return
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.cacheFile, 'utf8'))
    } catch {
      return
    }
    if (!isObj(parsed) || parsed.version !== CACHE_VERSION || !isObj(parsed.files)) return
    for (const [rel, raw] of Object.entries(parsed.files)) {
      if (!isObj(raw) || !isObj(raw.buckets)) continue
      const entry: FileEntry = {
        size: int(raw.size),
        offset: int(raw.offset),
        mtimeMs: typeof raw.mtimeMs === 'number' ? raw.mtimeMs : undefined,
        ids: Array.isArray(raw.ids) ? raw.ids.filter((x): x is string => typeof x === 'string') : [],
        buckets: {},
        gone: raw.gone === true ? true : undefined,
      }
      if (!entry.gone) delete entry.gone
      if (entry.mtimeMs === undefined) delete entry.mtimeMs
      for (const id of entry.ids) if (!this.owners.has(id)) this.owners.set(id, rel)
      for (const [key, t] of Object.entries(raw.buckets)) {
        if (!isObj(t)) continue
        const totals: UsageTotals = {
          messages: int(t.messages),
          input: int(t.input),
          output: int(t.output),
          cacheWrite5m: int(t.cacheWrite5m),
          cacheWrite1h: int(t.cacheWrite1h),
          cacheRead: int(t.cacheRead),
        }
        entry.buckets[key] = totals
        this.addTotal(key, totals, 1)
      }
      if (isObj(raw.hours)) {
        entry.hours = {}
        for (const [key, n] of Object.entries(raw.hours)) {
          const v = int(n)
          if (!v || !/^\d{4}-\d{2}-\d{2}\|\d{1,2}$/.test(key)) continue
          entry.hours[key] = v
          this.addHour(key, v)
        }
      }
      if (isObj(raw.tools)) {
        entry.tools = {}
        for (const [key, n] of Object.entries(raw.tools)) {
          const v = int(n)
          if (!v || !TOOL_KEY_RE.test(key)) continue
          entry.tools[key] = v
          this.addTool(key, v)
        }
      }
      this.files.set(rel, entry)
    }
    this.dirty.clear()
  }

  private scheduleSave(): void {
    this.saveNeeded = true
    if (this.saveTimer || !this.cacheFile) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, this.options.saveDebounceMs ?? 300_000)
  }

  private saveNow(): void {
    this.saveNeeded = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    void this.save()
  }

  private save(): Promise<void> {
    if (!this.cacheFile || !this.saveNeeded) return Promise.resolve()
    if (this.saving) return this.saving.then(() => this.save())
    this.saveNeeded = false
    const cacheFile = this.cacheFile
    const body: CacheFile = { version: CACHE_VERSION, files: Object.fromEntries(this.files) }
    const tmp = `${cacheFile}.tmp`
    this.saving = (async () => {
      try {
        await mkdir(path.dirname(cacheFile), { recursive: true })
        await writeFile(tmp, JSON.stringify(body))
        await renameWithRetry(tmp, cacheFile)
      } catch (err) {
        this.saveNeeded = true
        console.error('[collector] cannot save usage cache:', (err as Error).message)
      } finally {
        this.saving = null
      }
    })()
    return this.saving
  }
}
