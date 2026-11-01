// Agent data folders (v76 R7): what each top-level entry of ~/.claude and ~/.codex is, and what Orrery may clean.
// Table verified on Claude Code 2.1.294 / Codex 0.162 (docs §11al, codex-integration §7). Anything not listed is `unknown`.

export type DataAgent = 'claude' | 'codex'
export const DATA_AGENTS: readonly DataAgent[] = ['claude', 'codex']

/** cache = safe to delete (rebuilt / only logs); history = resume, History, stats; config = settings / secrets; program = installed code. */
export type DataKind = 'cache' | 'history' | 'config' | 'program' | 'unknown'

export interface DataGroupRule {
  id: string
  kind: DataKind
  /** Exact top-level names, or `prefix*`. */
  names: readonly string[]
  /** Orrery may delete old files inside it (only `cache` groups). */
  cleanable?: boolean
  /** Used by a running agent (sourced / open): cleaned only while no process of that agent runs. */
  idleOnly?: boolean
}

const CLAUDE_GROUPS: readonly DataGroupRule[] = [
  { id: 'transcripts', kind: 'history', names: ['projects'] },
  { id: 'liveSessions', kind: 'history', names: ['sessions'] },
  { id: 'promptHistory', kind: 'history', names: ['history.jsonl', 'paste-cache'] },
  { id: 'checkpoints', kind: 'history', names: ['file-history'] },
  { id: 'notes', kind: 'history', names: ['plans', 'todos', 'tasks', 'teams', 'agent-memory', 'agent-memory-local', 'memory', 'usage-data'] },
  { id: 'debugLogs', kind: 'cache', names: ['debug', 'logs', 'telemetry', 'statsig', 'traces', 'startup-perf', 'api-dumps', 'dump-prompts'], cleanable: true },
  { id: 'shellSnapshots', kind: 'cache', names: ['shell-snapshots', 'session-env'], cleanable: true, idleOnly: true },
  {
    id: 'appCache',
    kind: 'cache',
    names: ['cache', 'image-cache', 'mcp-discovery-cache', 'mcp-health-cache.json', 'mcp-needs-auth-cache.json', 'stats-cache.json'],
    cleanable: true,
  },
  { id: 'plugins', kind: 'program', names: ['plugins'] },
  { id: 'extensions', kind: 'config', names: ['skills', 'agents', 'commands', 'hooks', 'output-styles', 'workflows', 'rules', 'routines', 'themes'] },
  {
    id: 'settings',
    kind: 'config',
    names: [
      'settings.json*',
      'settings.local.json*',
      'CLAUDE.md',
      'keybindings.json',
      'policy-limits.json*',
      'remote-settings.json*',
      'scheduled_tasks.json',
      'launch.json',
      'backups',
      '.last-cleanup',
      '.last-update-result.json',
      'daemon*',
      'state',
      'jobs',
      'ide',
      'chrome',
    ],
  },
  { id: 'credentials', kind: 'config', names: ['.credentials.json', 'channels'] },
]

const CODEX_GROUPS: readonly DataGroupRule[] = [
  { id: 'rollouts', kind: 'history', names: ['sessions', 'archived_sessions'] },
  {
    id: 'threads',
    kind: 'history',
    names: ['thread_history_*', 'state_*', 'session_index.jsonl', 'history.jsonl', 'goals_*', 'queue_*', 'memories*', 'attachments'],
  },
  { id: 'generatedImages', kind: 'history', names: ['generated_images'] },
  { id: 'codexLogs', kind: 'cache', names: ['log', 'sandbox*.log'], cleanable: true },
  { id: 'logDb', kind: 'cache', names: ['logs_*'] },
  { id: 'codexCache', kind: 'cache', names: ['cache', 'models_cache.json'], cleanable: true },
  { id: 'codexTemp', kind: 'cache', names: ['.tmp', 'tmp'], cleanable: true, idleOnly: true },
  { id: 'codexPrograms', kind: 'program', names: ['packages', 'plugins', '.sandbox-bin', 'vendor_imports'] },
  { id: 'codexExtensions', kind: 'config', names: ['skills', 'rules', 'AGENTS.md', 'hooks.json'] },
  {
    id: 'codexSettings',
    kind: 'config',
    names: [
      'config.toml*',
      'version.json',
      '.codex-global-state.json*',
      '..codex-global-state.json*',
      'computer-use',
      'browser',
      'chrome-native-hosts*',
      'app-server-*',
      'process_manager',
      '*-locks',
      '.personality_migration',
      '.sandbox_migration',
      '.app-server-state-reconciled-*',
      '.codex-provisioning-*',
      '.sqlite-maintenance.lock',
    ],
  },
  { id: 'codexCredentials', kind: 'config', names: ['auth.json', '.sandbox-secrets', '.sandbox', 'cap_sid', 'installation_id'] },
]

export const DATA_GROUPS: Readonly<Record<DataAgent, readonly DataGroupRule[]>> = { claude: CLAUDE_GROUPS, codex: CODEX_GROUPS }

function matches(pattern: string, name: string): boolean {
  if (pattern.startsWith('*')) return name.endsWith(pattern.slice(1))
  const star = pattern.indexOf('*')
  if (star < 0) return pattern === name
  return name.startsWith(pattern.slice(0, star)) && name.endsWith(pattern.slice(star + 1)) && name.length >= pattern.length - 1
}

const UNKNOWN: DataGroupRule = { id: 'unknown', kind: 'unknown', names: [] }

/** Group of one top-level entry; names are compared case-insensitively on Windows only (callers pass the platform). */
export function classifyEntry(agent: DataAgent, name: string, caseInsensitive = false): DataGroupRule {
  const n = caseInsensitive ? name.toLowerCase() : name
  for (const g of DATA_GROUPS[agent]) {
    if (g.names.some((p) => matches(caseInsensitive ? p.toLowerCase() : p, n))) return g
  }
  return UNKNOWN
}

export function groupRule(agent: DataAgent, id: string): DataGroupRule | null {
  return DATA_GROUPS[agent].find((g) => g.id === id) ?? null
}

export const CLEAN_AGE_DAYS = [0, 7, 30, 90] as const
/** A file written in the last day is never cleaned, whatever the age choice. */
export const CLEAN_MIN_AGE_MS = 24 * 60 * 60 * 1000
export const STRIP_AGE_DAYS = [30, 60, 90] as const

export interface DataEntrySize {
  name: string
  dir: boolean
  /** Junction / symlink: listed with its target, never walked. */
  link: string | null
  files: number
  bytes: number
  newestMs: number | null
}

export interface DataGroupSize {
  id: string
  kind: DataKind
  cleanable: boolean
  idleOnly: boolean
  files: number
  bytes: number
  entries: DataEntrySize[]
}

export interface AgentDataSize {
  agent: DataAgent | 'claudeApp'
  root: string
  exists: boolean
  files: number
  bytes: number
  groups: DataGroupSize[]
}

export interface MoveRecord {
  agent: DataAgent
  source: string
  target: string
  /** `<source>.orrery-moved-<ts>`, the untouched original. */
  backup: string
  at: number
  phase: 'copying' | 'copied' | 'switching' | 'linked' | 'undoing' | 'interrupted'
  originalDeleted: boolean
}

export interface AgentDataPlace {
  agent: DataAgent
  root: string
  exists: boolean
  /** Root is already a junction / symlink (moved by Orrery or by hand). */
  linkTarget: string | null
  move: MoveRecord | null
}

export interface AgentDataState {
  places: AgentDataPlace[]
  claudeApp: string | null
  busy: AgentDataOp | null
  /** A move interrupted by a quit / crash that the app rolled back at start. */
  recovered: DataAgent[]
}

export type AgentDataOp = 'scan' | 'clean' | 'strip' | 'move' | 'undo' | 'delete'

export interface AgentDataProgress {
  op: AgentDataOp
  agent?: DataAgent
  files: number
  bytes: number
  totalBytes?: number
  phase?: 'copy' | 'verify' | 'switch' | 'check' | 'backup' | 'rewrite' | 'delete'
}

export type AgentDataError =
  | 'invalid'
  | 'busy'
  | 'cancelled'
  | 'running'
  | 'not-found'
  | 'already-moved'
  | 'not-moved'
  | 'target-exists'
  | 'target-inside'
  | 'not-local'
  | 'no-space'
  | 'verify-failed'
  | 'locked'
  | 'nothing'
  | 'failed'

export interface AgentProc {
  pid: number
  name: string
}

export interface AgentDataResult {
  ok: boolean
  error?: AgentDataError
  /** For `running`: the agent processes that block the action. */
  procs?: AgentProc[]
  files?: number
  bytes?: number
  /** Files that could not be read / deleted / copied (special files, locks). */
  skipped?: number
  path?: string
}

export interface CleanRequest {
  agent: DataAgent
  groups: string[]
  olderDays: number
}

export function parseCleanRequest(raw: unknown): CleanRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isDataAgent(r.agent) || !Array.isArray(r.groups) || r.groups.length === 0 || r.groups.length > 20) return null
  if (!CLEAN_AGE_DAYS.includes(r.olderDays as (typeof CLEAN_AGE_DAYS)[number])) return null
  const agent = r.agent
  const groups: string[] = []
  for (const g of r.groups) {
    const rule = typeof g === 'string' ? groupRule(agent, g) : null
    if (!rule?.cleanable) return null
    if (!groups.includes(rule.id)) groups.push(rule.id)
  }
  return { agent, groups, olderDays: r.olderDays as number }
}

export const isDataAgent = (v: unknown): v is DataAgent => v === 'claude' || v === 'codex'

/** Name of the renamed original next to the source. */
export const movedName = (base: string, at: number): string => `${base}.orrery-moved-${at}`
