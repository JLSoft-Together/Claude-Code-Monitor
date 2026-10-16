import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  contextWindowOf,
  usablePct,
  isAgentFinished,
  mainAgentStatus,
  mapRegistryStatus,
  mapTaskNotificationStatus,
  type ActivityEvent,
  type Agent,
  type AgentStatus,
  type TerminalSession,
  type ToolSpan,
} from '@ccm/shared'
import type { PeerInbound, PeerSent } from './peers'
import type { RegistryRecord } from './registry'
import { JsonlTailer, type LineFilter } from './tailer'
import { SPAN_RETENTION_MS, ToolSpanLog } from './tool-spans'
import { extractSignals, TranscriptState, type Signal } from './transcript'

export type ActivityDraft = Omit<ActivityEvent, 'id' | 'at'> & { at?: string }

export interface ContextHints {
  settingsModel?: string
  modelWindows?: Record<string, number>
  sessionWindows?: Map<string, number>
  /** Status line reports per session: Claude Code's used % of the full window and the auto-compact buffer. */
  sessionContext?: Map<string, { pct?: number; bufferPct?: number; at: string }>
  /** Buffer from the collector's own CLAUDE_CODE_AUTO_COMPACT_WINDOW, used when the bridge sent none. */
  bufferPct?: number
}

interface SubagentMeta {
  agentType?: string
  description?: string
  toolUseId?: string
  spawnDepth?: number
  parentAgentId?: string
  model?: string
}

interface SubagentEntry {
  agentId: string
  meta: SubagentMeta
  tailer: JsonlTailer
  state: TranscriptState
  startedAt?: string
  status: AgentStatus
  resolved: boolean
  completedAt?: string
}

const AGENT_TOOL_NAMES = new Set(['Agent', 'Task'])
const MAX_DESCRIPTION = 160
/** A finished subagent's last bytes are always parsed in full, whatever the lite filter would skip. */
export const LITE_TAIL_BYTES = 1024 * 1024

/** What a sync reads. No scope = every file; the projects watcher passes the files it saw change. */
export interface SyncScope {
  files?: Iterable<string>
  skipResolved?: boolean
}

interface SyncPlan {
  all: boolean
  unresolved: boolean
  files: Set<string>
}

const TYPE_KEY = Buffer.from('"type":"')
const BRANCH_KEY = Buffer.from('"gitBranch":"')
const SIGNAL_TYPES = ['assistant"', 'user"', 'system"', 'permission-mode"', 'queue-operation"'].map((t) => Buffer.from(t))
const USER_TYPE = Buffer.from('"type":"user"')
const NOTIFICATION_TAG = Buffer.from('<task-notification>')
const TOOL_USE_ID_KEY = Buffer.from('"tool_use_id":"')
const QUEUED_COMMAND_TYPE = [Buffer.from('queued_command"')]
const MESSAGE_KINDS = [Buffer.from('"kind":"coordinator"'), Buffer.from('"kind":"peer"')]

const hasMessageKind = (line: Buffer): boolean => MESSAGE_KINDS.some((k) => line.indexOf(k) !== -1)

function addKey(map: Map<string, Set<string>>, agentId: string, key: string): void {
  let keys = map.get(agentId)
  if (!keys) map.set(agentId, (keys = new Set()))
  keys.add(key)
}

function hasTypeValue(line: Buffer, values: Buffer[]): boolean {
  let at = line.indexOf(TYPE_KEY)
  while (at !== -1) {
    const from = at + TYPE_KEY.length
    for (const v of values) if (line.compare(v, 0, v.length, from, from + v.length) === 0) return true
    at = line.indexOf(TYPE_KEY, from)
  }
  return false
}

/**
 * Lines whose top-level type yields no signal but the branch (attachments, titles, file history…) skip JSON.parse.
 * Keys inside JSON string values are escaped (\"type\"), so a raw match is a real key; a nested match only costs a parse.
 */
export const signalLineFilter: LineFilter = (line) => {
  if (hasTypeValue(line, SIGNAL_TYPES)) return undefined
  if (hasMessageKind(line) && hasTypeValue(line, QUEUED_COMMAND_TYPE)) return undefined
  const at = line.lastIndexOf(BRANCH_KEY)
  if (at === -1) return null
  const from = at + BRANCH_KEY.length
  const m = /^([^"\\]{1,200})"/.exec(line.subarray(from, from + 202).toString('utf8'))
  return m ? { gitBranch: m[1] } : undefined
}

function toolUseIdsOf(line: Buffer): string[] {
  const ids: string[] = []
  let at = line.indexOf(TOOL_USE_ID_KEY)
  while (at !== -1) {
    const from = at + TOOL_USE_ID_KEY.length
    const end = line.indexOf(0x22, from)
    if (end === -1 || end - from > 200) break
    ids.push(line.toString('latin1', from, end))
    at = line.indexOf(TOOL_USE_ID_KEY, end)
  }
  return ids
}

const toIso = (ms: number | undefined): string | undefined =>
  ms === undefined || ms <= 0 ? undefined : new Date(ms).toISOString()

const laterOf = (...values: (string | undefined)[]): string | undefined => {
  let best: string | undefined
  for (const v of values) if (v && (!best || v > best)) best = v
  return best
}

export function terminalIdOf(record: RegistryRecord): string {
  return `${record.pid}:${record.procStart ?? record.startedAt ?? 0}`
}

export function cwdSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

export async function findTranscript(projectsDir: string, sessionId: string, cwd?: string): Promise<string | null> {
  const fileName = `${sessionId}.jsonl`
  if (cwd) {
    const guess = path.join(projectsDir, cwdSlug(cwd), fileName)
    if (await exists(guess)) return guess
  }
  let dirs: string[]
  try {
    dirs = await readdir(projectsDir)
  } catch {
    return null
  }
  for (const dir of dirs) {
    const candidate = path.join(projectsDir, dir, fileName)
    if (await exists(candidate)) return candidate
  }
  return null
}

function parseMeta(text: string): SubagentMeta {
  try {
    const o: unknown = JSON.parse(text)
    if (typeof o !== 'object' || o === null) return {}
    const r = o as Record<string, unknown>
    const description = typeof r.description === 'string' ? r.description.slice(0, MAX_DESCRIPTION) : undefined
    return {
      agentType: typeof r.agentType === 'string' ? r.agentType : undefined,
      description,
      toolUseId: typeof r.toolUseId === 'string' ? r.toolUseId : undefined,
      spawnDepth: typeof r.spawnDepth === 'number' ? r.spawnDepth : undefined,
      parentAgentId: typeof r.parentAgentId === 'string' && /^[A-Za-z0-9_-]+$/.test(r.parentAgentId) ? r.parentAgentId : undefined,
      model: typeof r.model === 'string' ? r.model : undefined,
    }
  } catch {
    return {}
  }
}

export class SessionTracker {
  record: RegistryRecord
  shell?: string
  parentPid?: number
  endedAt?: string

  private transcriptPath: string | null = null
  private mainTailer: JsonlTailer | null = null
  private main = new TranscriptState()
  private subagents = new Map<string, SubagentEntry>()
  private notifications = new Map<string, { status: string; at?: string }>()
  private foregroundResults = new Map<string, { isError: boolean; at?: string }>()
  private agentToolUses = new Set<string>()
  private readonly msgIn = new Map<string, Set<string>>()
  private readonly msgOut = new Map<string, Set<string>>()
  private syncing: Promise<ActivityDraft[]> | null = null
  private syncAgain = false
  private plan: SyncPlan = { all: false, unresolved: false, files: new Set() }
  private readonly spans: ToolSpanLog
  private pendingSpans: ToolSpan[] = []
  private pendingPeers: { inbound: PeerInbound[]; sent: PeerSent[] } = { inbound: [], sent: [] }

  constructor(
    readonly terminalId: string,
    record: RegistryRecord,
    private readonly projectsDir: string,
    private readonly hints: ContextHints = {},
    private readonly now: () => number = Date.now,
  ) {
    this.record = record
    this.spans = new ToolSpanLog(terminalId, now)
  }

  drainSpans(): ToolSpan[] {
    const out = this.pendingSpans
    this.pendingSpans = []
    return out
  }

  drainPeers(): { inbound: PeerInbound[]; sent: PeerSent[] } {
    const out = this.pendingPeers
    this.pendingPeers = { inbound: [], sent: [] }
    return out
  }

  closeOpenSpans(at: string): ToolSpan[] {
    return this.spans.closeOpen(at)
  }

  toolSpans(sinceMs?: number): ToolSpan[] {
    return this.spans.list(sinceMs)
  }

  get sessionId(): string | undefined {
    return this.record.sessionId
  }

  get mainAgentId(): string {
    return `${this.terminalId}:main`
  }

  get ended(): boolean {
    return this.endedAt !== undefined
  }

  setRecord(record: RegistryRecord): { sessionChanged: boolean } {
    const sessionChanged = record.sessionId !== this.record.sessionId
    this.record = record
    if (sessionChanged) this.resetSession()
    return { sessionChanged }
  }

  markEnded(at: string): void {
    this.endedAt = at
  }

  private resetSession(): void {
    this.transcriptPath = null
    this.mainTailer = null
    this.main = new TranscriptState()
    this.subagents.clear()
    this.notifications.clear()
    this.foregroundResults.clear()
    this.agentToolUses.clear()
    this.msgIn.clear()
    this.msgOut.clear()
  }

  sync(catchUp: boolean, scope: SyncScope = {}): Promise<ActivityDraft[]> {
    if (scope.files) for (const f of scope.files) this.plan.files.add(path.basename(f))
    else if (scope.skipResolved) this.plan.unresolved = true
    else this.plan.all = true
    if (this.syncing) {
      this.syncAgain = true
      return this.syncing.then(() => [])
    }
    this.syncing = (async () => {
      const out: ActivityDraft[] = []
      do {
        this.syncAgain = false
        const plan = this.plan
        this.plan = { all: false, unresolved: false, files: new Set() }
        out.push(...(await this.syncOnce(catchUp, plan)))
      } while (this.syncAgain)
      return out
    })().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async syncOnce(catchUp: boolean, plan: SyncPlan): Promise<ActivityDraft[]> {
    const activity: ActivityDraft[] = []
    const sessionId = this.record.sessionId
    if (!sessionId) return activity

    let readMain = plan.all || plan.unresolved || plan.files.has(`${sessionId}.jsonl`)
    if (!this.transcriptPath) {
      this.transcriptPath = await findTranscript(this.projectsDir, sessionId, this.record.cwd)
      if (!this.transcriptPath) return activity
      this.mainTailer = new JsonlTailer(this.transcriptPath)
      readMain = true
    }

    if (this.mainTailer && readMain) {
      await this.mainTailer.readEach((rec) => this.applyMain(extractSignals(rec), catchUp, activity), signalLineFilter)
    }

    const fresh = await this.discoverSubagents(catchUp, activity)

    for (const entry of this.subagents.values()) {
      const wanted = plan.all || fresh.has(entry) || plan.files.has(`agent-${entry.agentId}.jsonl`) || (plan.unresolved && !entry.resolved)
      if (wanted) await this.readSubagent(entry, catchUp, activity)
    }
    for (const entry of this.subagents.values()) this.resolveSubagent(entry, catchUp, activity)
    this.spans.prune()
    return activity
  }

  private async readSubagent(entry: SubagentEntry, catchUp: boolean, activity: ActivityDraft[]): Promise<void> {
    const lite = catchUp && !entry.resolved && (await this.isLiteCatchUp(entry))
    await entry.tailer.readEach(
      (rec) => {
        const signals = extractSignals(rec)
        this.recordLinks(signals)
        this.recordMessages(signals, entry.agentId)
        this.recordPeers(signals, entry.agentId, catchUp, false)
        if (!lite) this.trackSpans(signals, entry.agentId, catchUp)
        if (!catchUp) this.toolActivity(signals, entry.state, entry.agentId, activity)
        entry.state.apply(signals)
      },
      lite ? this.liteFilter : signalLineFilter,
    )
  }

  /**
   * Catch-up of a subagent the main transcript already reports finished, every write older than span retention:
   * all its spans would end before the cutoff and be pruned, and its open-tool list is hidden once finished. So it
   * records no spans, and its user lines before the last LITE_TAIL_BYTES are dropped unparsed unless they carry a
   * notification or another agent's result.
   */
  private async isLiteCatchUp(entry: SubagentEntry): Promise<boolean> {
    const linked = this.linkedOutcome(entry)
    const cutoff = this.now() - SPAN_RETENTION_MS
    if (!linked || (!isAgentFinished(linked.status) && linked.status !== 'unknown') || !(Date.parse(linked.at ?? '') < cutoff)) return false
    const mtime = await stat(entry.tailer.file).then((st) => st.mtimeMs, () => Infinity)
    return mtime < cutoff
  }

  private readonly liteFilter: LineFilter = (line, end, size) => {
    if (end > size - LITE_TAIL_BYTES || line.indexOf(USER_TYPE) === -1) return signalLineFilter(line, end, size)
    if (line.indexOf(NOTIFICATION_TAG) !== -1 || hasMessageKind(line)) return undefined
    for (const id of toolUseIdsOf(line)) if (this.agentToolUses.has(id)) return undefined
    return null
  }

  private applyMain(signals: Signal[], catchUp: boolean, activity: ActivityDraft[]): void {
    this.recordLinks(signals)
    this.recordMessages(signals)
    this.recordPeers(signals, this.mainAgentId, catchUp, true)
    this.trackSpans(signals, this.mainAgentId, catchUp)
    if (!catchUp) {
      this.toolActivity(signals, this.main, this.mainAgentId, activity)
      this.sessionActivity(signals, activity)
    }
    this.main.apply(signals)
  }

  private trackSpans(signals: Signal[], agentId: string, catchUp: boolean): void {
    const changed = this.spans.apply(signals, agentId)
    if (!catchUp) this.pendingSpans.push(...changed)
  }

  private sessionActivity(signals: Signal[], activity: ActivityDraft[]): void {
    let mode = this.main.permissionMode
    for (const s of signals) {
      if (s.k === 'compact') {
        activity.push({
          kind: 'terminal.compacted',
          terminalId: this.terminalId,
          at: s.at,
          data: { trigger: s.trigger, preTokens: s.preTokens, postTokens: s.postTokens },
        })
      } else if (s.k === 'permission_mode' && s.mode !== mode) {
        if (mode !== undefined) activity.push({ kind: 'terminal.mode', terminalId: this.terminalId, data: { mode: s.mode } })
        mode = s.mode
      }
    }
  }

  private contextOf(
    state: TranscriptState,
    model: string | undefined,
    main = false,
  ): { contextTokens?: number; contextWindow?: number; contextPct?: number } {
    if (state.contextTokens === undefined) return {}
    const sessionId = this.record.sessionId
    const contextWindow = contextWindowOf(model, {
      settingsModel: this.hints.settingsModel,
      peak: state.peakContext,
      reported: main && sessionId ? this.hints.sessionWindows?.get(sessionId) : undefined,
      catalog: model ? this.hints.modelWindows?.[model.replace('[1m]', '')] : undefined,
    })
    const report = main && sessionId ? this.hints.sessionContext?.get(sessionId) : undefined
    const buffer = report?.bufferPct ?? this.hints.bufferPct
    // The status line runs after each reply; a report older than the latest reply describes the previous prompt.
    const reported = report?.pct !== undefined && (!state.cacheAt || report.at >= state.cacheAt) ? report.pct : undefined
    const raw = reported ?? (contextWindow ? (state.contextTokens / contextWindow) * 100 : undefined)
    return {
      contextTokens: state.contextTokens,
      contextWindow,
      contextPct: raw === undefined ? undefined : Math.round(usablePct(raw, buffer) * 10) / 10,
    }
  }

  private recordLinks(signals: Signal[]): void {
    for (const s of signals) {
      if (s.k === 'tool_use' && AGENT_TOOL_NAMES.has(s.name)) this.agentToolUses.add(s.id)
      if (s.k === 'tool_result' && this.agentToolUses.has(s.toolUseId) && !s.asyncLaunched) {
        this.foregroundResults.set(s.toolUseId, { isError: s.isError, at: s.at })
      }
      if (s.k === 'task_notification' && s.toolUseId) {
        this.notifications.set(s.toolUseId, { status: s.status, at: s.at })
      }
    }
  }

  private recordMessages(signals: Signal[], agentId?: string): void {
    for (const s of signals) {
      if (s.k === 'handback') addKey(this.msgOut, s.from, s.key)
      else if (agentId && s.k === 'coordinator_msg') addKey(this.msgIn, agentId, s.key)
      else if (agentId && s.k === 'send_main') addKey(this.msgOut, agentId, s.key)
    }
  }

  private recordPeers(signals: Signal[], agentId: string, catchUp: boolean, main: boolean): void {
    for (const s of signals) {
      if (s.k === 'peer_sent') this.pendingPeers.sent.push({ terminalId: this.terminalId, agentId, msgId: s.msgId, at: s.at })
      else if (main && s.k === 'peer_in') {
        this.pendingPeers.inbound.push({ receiver: this.terminalId, fromKey: s.fromKey, msgId: s.msgId, dedupeKey: s.dedupeKey, at: s.at, live: !catchUp })
      }
    }
  }

  private toolActivity(signals: Signal[], state: TranscriptState, agentId: string, activity: ActivityDraft[]): void {
    for (const s of signals) {
      if (s.k === 'tool_use') {
        activity.push({ kind: 'tool.started', terminalId: this.terminalId, agentId, at: s.at, data: { tool: s.name } })
      } else if (s.k === 'tool_result' && s.isError) {
        const tool = state.openTools.get(s.toolUseId)
        activity.push({ kind: 'tool.failed', terminalId: this.terminalId, agentId, at: s.at, data: { tool } })
      }
    }
  }

  private async discoverSubagents(catchUp: boolean, activity: ActivityDraft[]): Promise<Set<SubagentEntry>> {
    const fresh = new Set<SubagentEntry>()
    if (!this.transcriptPath) return fresh
    const dir = path.join(this.transcriptPath.slice(0, -'.jsonl'.length), 'subagents')
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return fresh
    }
    for (const name of names) {
      const m = name.match(/^agent-([A-Za-z0-9_-]+)\.meta\.json$/)
      if (!m?.[1] || this.subagents.has(m[1])) continue
      const agentId = m[1]
      const metaFile = path.join(dir, name)
      let meta: SubagentMeta = {}
      let startedAt: string | undefined
      try {
        meta = parseMeta(await readFile(metaFile, 'utf8'))
        const st = await stat(metaFile)
        startedAt = new Date(st.birthtimeMs || st.mtimeMs).toISOString()
      } catch {
        continue
      }
      const entry: SubagentEntry = {
        agentId,
        meta,
        tailer: new JsonlTailer(path.join(dir, `agent-${agentId}.jsonl`)),
        state: new TranscriptState(),
        startedAt,
        status: 'working',
        resolved: false,
      }
      this.subagents.set(agentId, entry)
      fresh.add(entry)
      if (!catchUp) {
        activity.push({
          kind: 'agent.started',
          terminalId: this.terminalId,
          agentId,
          at: startedAt,
          data: { agentType: meta.agentType, description: meta.description },
        })
      }
    }
    return fresh
  }

  /** What the main (or a parent) transcript says about this subagent: a notification wins over a foreground result. */
  private linkedOutcome(entry: SubagentEntry): { status: AgentStatus; at?: string } | null {
    const toolUseId = entry.meta.toolUseId
    if (!toolUseId) return null
    const note = this.notifications.get(toolUseId)
    if (note) return { status: mapTaskNotificationStatus(note.status), at: note.at }
    const fg = this.foregroundResults.get(toolUseId)
    return fg ? { status: fg.isError ? 'error' : 'completed', at: fg.at } : null
  }

  private resolveSubagent(entry: SubagentEntry, catchUp: boolean, activity: ActivityDraft[]): void {
    if (entry.resolved) return
    let status: AgentStatus = 'working'
    let at: string | undefined
    const linked = this.linkedOutcome(entry)
    if (linked) {
      status = linked.status
      at = linked.at
    } else if (entry.state.ended && entry.state.openTools.size === 0) {
      status = 'completed'
      at = entry.state.lastEndAt
    }
    if (!isAgentFinished(status) && status !== 'unknown') return
    entry.status = status
    entry.resolved = true
    entry.completedAt = at ?? entry.state.lastAt
    const closed = entry.completedAt ? this.spans.closeOpen(entry.completedAt, entry.agentId) : []
    if (catchUp) return
    this.pendingSpans.push(...closed)
    const kind = status === 'completed' ? 'agent.completed' : status === 'cancelled' ? 'agent.cancelled' : 'agent.failed'
    activity.push({
      kind,
      terminalId: this.terminalId,
      agentId: entry.agentId,
      at: entry.completedAt,
      data: { agentType: entry.meta.agentType, description: entry.meta.description },
    })
  }

  codexCalls(): { agentId: string; at: string }[] {
    const out = this.main.codexCalls.map((at) => ({ agentId: this.mainAgentId, at }))
    for (const e of this.subagents.values()) for (const at of e.state.codexCalls) out.push({ agentId: e.agentId, at })
    return out
  }

  buildTerminal(): TerminalSession {
    const r = this.record
    const mapped = mapRegistryStatus(r.status)
    const ended = this.ended
    let lastSub: string | undefined
    for (const e of this.subagents.values()) lastSub = laterOf(lastSub, e.state.lastAt)
    return {
      id: this.terminalId,
      processId: r.pid,
      parentProcessId: this.parentPid,
      shell: this.shell,
      title: r.name || (r.cwd ? path.basename(r.cwd) : `PID ${r.pid}`),
      nameSource: r.nameSource,
      kind: r.kind,
      entrypoint: r.entrypoint,
      cwd: r.cwd,
      claudeSessionId: r.sessionId,
      claudeVersion: r.version,
      rawStatus: r.status,
      status: ended ? 'stale' : mapped.status,
      statusSince: ended ? undefined : toIso(r.statusUpdatedAt),
      waitingFor: !ended && mapped.status === 'waiting' ? r.waitingFor : undefined,
      backgroundShell: !ended && mapped.backgroundShell ? true : undefined,
      permissionMode: this.main.permissionMode,
      gitBranch: this.main.gitBranch,
      compactions: this.main.compactions || undefined,
      startedAt: toIso(r.startedAt),
      lastActivityAt: laterOf(toIso(r.statusUpdatedAt), this.main.lastAt, lastSub),
      endedAt: this.endedAt,
    }
  }

  buildAgents(terminal: TerminalSession): Agent[] {
    const mainId = this.mainAgentId
    const mainStatus = mainAgentStatus(terminal.status)
    const mainTokens = this.main.tokens()
    const showTool = mainStatus === 'working' || mainStatus === 'waiting'
    const agents: Agent[] = [
      {
        id: mainId,
        terminalId: this.terminalId,
        role: 'main',
        name: terminal.title,
        type: 'main',
        model: this.main.model,
        effort: this.main.effort,
        status: mainStatus,
        currentTool: showTool ? this.main.currentTool() : undefined,
        startedAt: terminal.startedAt,
        updatedAt: this.main.lastAt,
        completedAt: terminal.endedAt,
        inputTokens: mainTokens?.input,
        outputTokens: mainTokens?.output,
        cacheReadTokens: mainTokens?.cacheRead,
        totalTokens: mainTokens ? mainTokens.input + mainTokens.output : undefined,
        ...this.contextOf(this.main, this.main.model, true),
        cacheTtl: this.main.cacheTtl,
        cacheAt: this.main.cacheAt,
      },
    ]
    for (const e of this.subagents.values()) {
      const tokens = e.state.tokens()
      const parentAgentId = e.meta.parentAgentId
      const parentId = parentAgentId && parentAgentId !== e.agentId && this.subagents.has(parentAgentId) ? parentAgentId : mainId
      const status: AgentStatus = this.ended && !e.resolved ? 'unknown' : e.status
      const msgIn = this.msgIn.get(e.agentId)?.size
      const msgOut = this.msgOut.get(e.agentId)?.size
      agents.push({
        id: e.agentId,
        parentId,
        terminalId: this.terminalId,
        role: 'subagent',
        name: e.meta.agentType,
        type: e.meta.agentType,
        description: e.meta.description,
        toolUseId: e.meta.toolUseId,
        spawnDepth: e.meta.spawnDepth,
        model: e.state.model ?? e.meta.model,
        effort: e.state.effort,
        status,
        currentTool: status === 'working' ? e.state.currentTool() : undefined,
        startedAt: e.startedAt,
        updatedAt: e.state.lastAt,
        completedAt: e.resolved ? e.completedAt : undefined,
        inputTokens: tokens?.input,
        outputTokens: tokens?.output,
        cacheReadTokens: tokens?.cacheRead,
        totalTokens: tokens ? tokens.input + tokens.output : undefined,
        ...this.contextOf(e.state, e.state.model ?? e.meta.model),
        ...(msgIn ? { msgIn } : {}),
        ...(msgOut ? { msgOut } : {}),
      })
    }
    return agents
  }
}
