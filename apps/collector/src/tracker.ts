import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  contextWindowOf,
  isAgentFinished,
  mainAgentStatus,
  mapRegistryStatus,
  mapTaskNotificationStatus,
  type ActivityEvent,
  type Agent,
  type AgentStatus,
  type TerminalSession,
} from '@ccm/shared'
import type { RegistryRecord } from './registry'
import { JsonlTailer } from './tailer'
import { extractSignals, TranscriptState, type Signal } from './transcript'

export type ActivityDraft = Omit<ActivityEvent, 'id' | 'at'> & { at?: string }

export interface ContextHints {
  settingsModel?: string
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
  private syncing: Promise<ActivityDraft[]> | null = null
  private syncAgain = false

  constructor(
    readonly terminalId: string,
    record: RegistryRecord,
    private readonly projectsDir: string,
    private readonly hints: ContextHints = {},
  ) {
    this.record = record
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
  }

  sync(catchUp: boolean): Promise<ActivityDraft[]> {
    if (this.syncing) {
      this.syncAgain = true
      return this.syncing.then(() => [])
    }
    this.syncing = (async () => {
      const out: ActivityDraft[] = []
      do {
        this.syncAgain = false
        out.push(...(await this.syncOnce(catchUp)))
      } while (this.syncAgain)
      return out
    })().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async syncOnce(catchUp: boolean): Promise<ActivityDraft[]> {
    const activity: ActivityDraft[] = []
    const sessionId = this.record.sessionId
    if (!sessionId) return activity

    if (!this.transcriptPath) {
      this.transcriptPath = await findTranscript(this.projectsDir, sessionId, this.record.cwd)
      if (!this.transcriptPath) return activity
      this.mainTailer = new JsonlTailer(this.transcriptPath)
    }

    if (this.mainTailer) {
      const records = await this.mainTailer.read()
      for (const rec of records) this.applyMain(extractSignals(rec), catchUp, activity)
    }

    await this.discoverSubagents(catchUp, activity)

    for (const entry of this.subagents.values()) {
      const records = await entry.tailer.read()
      for (const rec of records) {
        const signals = extractSignals(rec)
        this.recordLinks(signals)
        if (!catchUp) this.toolActivity(signals, entry.state, entry.agentId, activity)
        entry.state.apply(signals)
      }
    }
    for (const entry of this.subagents.values()) this.resolveSubagent(entry, catchUp, activity)
    return activity
  }

  private applyMain(signals: Signal[], catchUp: boolean, activity: ActivityDraft[]): void {
    this.recordLinks(signals)
    if (!catchUp) {
      this.toolActivity(signals, this.main, this.mainAgentId, activity)
      this.sessionActivity(signals, activity)
    }
    this.main.apply(signals)
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

  private contextOf(state: TranscriptState, model: string | undefined): { contextTokens?: number; contextWindow?: number } {
    if (state.contextTokens === undefined) return {}
    return {
      contextTokens: state.contextTokens,
      contextWindow: contextWindowOf(model, { settingsModel: this.hints.settingsModel, peak: state.peakContext }),
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

  private async discoverSubagents(catchUp: boolean, activity: ActivityDraft[]): Promise<void> {
    if (!this.transcriptPath) return
    const dir = path.join(this.transcriptPath.slice(0, -'.jsonl'.length), 'subagents')
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
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
  }

  private resolveSubagent(entry: SubagentEntry, catchUp: boolean, activity: ActivityDraft[]): void {
    if (entry.resolved) return
    const toolUseId = entry.meta.toolUseId
    let status: AgentStatus = 'working'
    let at: string | undefined
    const note = toolUseId ? this.notifications.get(toolUseId) : undefined
    const fg = toolUseId ? this.foregroundResults.get(toolUseId) : undefined
    if (note) {
      status = mapTaskNotificationStatus(note.status)
      at = note.at
    } else if (fg) {
      status = fg.isError ? 'error' : 'completed'
      at = fg.at
    } else if (entry.state.ended && entry.state.openTools.size === 0) {
      status = 'completed'
      at = entry.state.lastEndAt
    }
    if (!isAgentFinished(status) && status !== 'unknown') return
    entry.status = status
    entry.resolved = true
    entry.completedAt = at ?? entry.state.lastAt
    if (catchUp) return
    const kind = status === 'completed' ? 'agent.completed' : status === 'cancelled' ? 'agent.cancelled' : 'agent.failed'
    activity.push({
      kind,
      terminalId: this.terminalId,
      agentId: entry.agentId,
      at: entry.completedAt,
      data: { agentType: entry.meta.agentType, description: entry.meta.description },
    })
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
        ...this.contextOf(this.main, this.main.model),
        cacheTtl: this.main.cacheTtl,
        cacheAt: this.main.cacheAt,
      },
    ]
    for (const e of this.subagents.values()) {
      const tokens = e.state.tokens()
      const parentAgentId = e.meta.parentAgentId
      const parentId = parentAgentId && parentAgentId !== e.agentId && this.subagents.has(parentAgentId) ? parentAgentId : mainId
      const status: AgentStatus = this.ended && !e.resolved ? 'unknown' : e.status
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
      })
    }
    return agents
  }
}
