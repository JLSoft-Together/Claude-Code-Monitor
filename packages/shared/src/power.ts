import type { Agent, BackgroundJob, TerminalSession } from './types'

/** Keep the machine awake while agents run (v76 R3). `plugged` = only while on AC power. */
export const AWAKE_MODES = ['off', 'running', 'plugged'] as const
export type AwakeMode = (typeof AWAKE_MODES)[number]
export const DEFAULT_AWAKE_MODE: AwakeMode = 'plugged'
export const isAwakeMode = (v: unknown): v is AwakeMode => typeof v === 'string' && (AWAKE_MODES as readonly string[]).includes(v)

/** Collector → desktop main over the utilityProcess port, sent only when a count changes. */
export interface BusyMessage {
  type: 'busy'
  agents: number
  jobs: number
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100_000 ? v : null)

export function parseBusy(raw: unknown): BusyMessage | null {
  const r = raw as Partial<BusyMessage> | null
  if (!r || typeof r !== 'object' || r.type !== 'busy') return null
  const agents = count(r.agents)
  const jobs = count(r.jobs)
  return agents === null || jobs === null ? null : { type: 'busy', agents, jobs }
}

/** Working sessions plus working subagents, and running background jobs. */
export function busyCounts(
  terminals: Iterable<Pick<TerminalSession, 'status'>>,
  agents: Iterable<Pick<Agent, 'role' | 'status'>>,
  jobs: Iterable<Pick<BackgroundJob, 'state'>>,
): { agents: number; jobs: number } {
  let busy = 0
  let running = 0
  for (const t of terminals) if (t.status === 'working') busy++
  for (const a of agents) if (a.role === 'subagent' && a.status === 'working') busy++
  for (const j of jobs) if (j.state === 'working') running++
  return { agents: busy, jobs: running }
}

/**
 * Why the blocker is (not) held: `working` = something runs, `grace` = all stopped less than 2 minutes ago,
 * `battery` = would hold but the mode wants AC power, `idle` = nothing runs, `off` = setting off.
 */
export type AwakeReason = 'off' | 'idle' | 'working' | 'grace' | 'battery'

export interface AwakeState {
  mode: AwakeMode
  holding: boolean
  reason: AwakeReason
  agents: number
  jobs: number
  /** While `grace`: when the blocker is released if nothing starts again. */
  releaseAt: number | null
}

/** Capture folder for screenshots / recordings (v76 R4). `dir` null = old behaviour (temp + clipboard). */
export interface CaptureConfig {
  dir: string | null
  /** Screenshots / frames go to the agent as a file path instead of clipboard bytes. */
  asFile: boolean
  keepDays: number
  maxGb: number
}

export const CAPTURE_KEEP_DAYS = [1, 3, 7, 14, 30] as const
export const CAPTURE_MAX_GB = [1, 2, 5, 10, 20] as const
export const DEFAULT_CAPTURE: CaptureConfig = { dir: null, asFile: true, keepDays: 7, maxGb: 2 }

export type CaptureProblem = 'missing' | 'not-writable'

export interface CaptureStatus {
  config: CaptureConfig
  /** Folder in use now; null when none is set or it is unusable (then temp is used). */
  active: string | null
  problem: CaptureProblem | null
}

export type CaptureShotResult = { ok: true; path: string } | { ok: false; error: 'no-dir' | 'invalid' | 'failed' }
