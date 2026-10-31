import { RES_IDLE_CPU_PCT, type Agent, type BackgroundJob, type ResPort, type TerminalSession } from '@ccm/shared'

/** Epoch ms since a live session sits idle / waiting with no subagent or background job running; null while busy. */
export function sessionIdleSince(t: TerminalSession, agents: readonly Agent[], jobs: readonly BackgroundJob[]): number | null {
  if (t.endedAt || (t.status !== 'idle' && t.status !== 'waiting')) return null
  if (agents.some((a) => a.terminalId === t.id && a.role === 'subagent' && a.status === 'working')) return null
  if (t.claudeSessionId && jobs.some((j) => j.sessionId === t.claudeSessionId && j.state === 'working')) return null
  const last = Date.parse(t.lastActivityAt ?? t.statusSince ?? '')
  return Number.isFinite(last) ? last : null
}

export function isForgotten(idleSince: number | null, now: number, idleMinutes: number): boolean {
  return idleMinutes > 0 && idleSince !== null && now - idleSince >= idleMinutes * 60_000
}

/** CPU unknown counts as busy: a process we can't measure is never called idle. */
export function serverBusy(cpuPct: number | null, ports: readonly ResPort[]): boolean {
  return cpuPct === null || cpuPct >= RES_IDLE_CPU_PCT || ports.some((p) => p.established > 0)
}

export interface BusyState {
  firstSeen: number
  lastBusy: number | null
}

export function trackBusy(prev: BusyState | undefined, busy: boolean, now: number): BusyState {
  const state = prev ? { ...prev } : { firstSeen: now, lastBusy: null }
  if (busy) state.lastBusy = now
  return state
}

/** Quiet streak start; only time watched counts, so a process seen at app start is idle from then at the earliest. */
export function idleSinceOf(state: BusyState, now: number): number | null {
  if (state.lastBusy === now) return null
  return Math.max(state.firstSeen, state.lastBusy ?? 0)
}

/** Emulator CPU stays high while idle; quiet means no Orrery adb use and no device tool call from a session. */
export function emulatorIdleSince(firstSeen: number, lastUse: number | null, lastCall: number | null): number {
  return Math.max(firstSeen, lastUse ?? 0, lastCall ?? 0)
}
