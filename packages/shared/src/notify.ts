import type { ActivityEvent, NotifySettings, QuietHours, SnoozeEntry, TerminalSession, ToastKind } from './types'

export const TOAST_KINDS: readonly ToastKind[] = ['waiting', 'done', 'job', 'loop', 'stuck', 'context', 'limit']
export const DEFAULT_TOAST_KINDS: Record<ToastKind, boolean> = { waiting: true, done: false, job: true, loop: true, stuck: true, context: true, limit: true }
export const STUCK_CHOICES = [0, 5, 10, 15, 30] as const
export const DEFAULT_STUCK_MINUTES = 10
export const DEFAULT_QUIET: QuietHours = { enabled: false, from: '22:00', to: '08:00' }

export const LONG_WAIT_MS = 5 * 60_000
export const MAX_REMINDERS = 3
export const SNOOZE_MAX_MIN = 24 * 60

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isHm(value: unknown): value is string {
  return typeof value === 'string' && HM.test(value)
}

function minutesOf(hm: string): number {
  const m = HM.exec(hm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

export function sanitizeQuiet(value: unknown): QuietHours | null {
  if (typeof value !== 'object' || value === null) return null
  const q = value as Partial<QuietHours>
  if (typeof q.enabled !== 'boolean' || !isHm(q.from) || !isHm(q.to)) return null
  return { enabled: q.enabled, from: q.from, to: q.to }
}

export function sanitizeKinds(value: unknown): Partial<Record<ToastKind, boolean>> | null {
  if (typeof value !== 'object' || value === null) return null
  const out: Partial<Record<ToastKind, boolean>> = {}
  for (const kind of TOAST_KINDS) {
    const v = (value as Record<string, unknown>)[kind]
    if (typeof v === 'boolean') out[kind] = v
  }
  return out
}

export function inQuietHours(quiet: QuietHours | null | undefined, at: Date): boolean {
  if (!quiet?.enabled || quiet.from === quiet.to) return false
  const now = at.getHours() * 60 + at.getMinutes()
  const from = minutesOf(quiet.from)
  const to = minutesOf(quiet.to)
  return from < to ? now >= from && now < to : now >= from || now < to
}

export function defaultNotifySettings(toast: NotifySettings['toast']): NotifySettings {
  return { toast, kinds: { ...DEFAULT_TOAST_KINDS }, quiet: { ...DEFAULT_QUIET }, stuckMinutes: DEFAULT_STUCK_MINUTES }
}

export function sanitizeStuck(value: unknown): number | null {
  return typeof value === 'number' && (STUCK_CHOICES as readonly number[]).includes(value) ? value : null
}

export function quietFor(terminal: TerminalSession, nowMs: number, thresholdMin: number): number | null {
  if (thresholdMin <= 0 || terminal.status !== 'working') return null
  const last = terminal.lastActivityAt ? Date.parse(terminal.lastActivityAt) : NaN
  if (!Number.isFinite(last)) return null
  const quiet = nowMs - last
  return quiet >= thresholdMin * 60_000 ? quiet : null
}

export function remindersDue(statusSince: string | undefined, nowMs: number): number {
  const since = statusSince ? Date.parse(statusSince) : NaN
  if (!Number.isFinite(since)) return 0
  return Math.max(0, Math.min(MAX_REMINDERS, Math.floor((nowMs - since) / LONG_WAIT_MS)))
}

export function snoozedUntil(entry: SnoozeEntry | undefined, terminal: TerminalSession | undefined, nowMs: number): number | null {
  if (!entry || !terminal || terminal.status !== 'waiting') return null
  return entry.until > nowMs && entry.since === terminal.statusSince ? entry.until : null
}

export interface ErrorLoop {
  failures: number
  calls: number
  tool: string | null
  since: string
}

export const LOOP_WINDOW_MS = 5 * 60_000
export const LOOP_MIN_FAILURES = 5

export function errorLoops(items: Iterable<ActivityEvent>, nowMs: number): Map<string, ErrorLoop> {
  const acc = new Map<string, { failures: number; calls: number; tools: Map<string, number>; since: string }>()
  for (const e of items) {
    if (!e.terminalId || (e.kind !== 'tool.started' && e.kind !== 'tool.failed')) continue
    const at = Date.parse(e.at)
    if (!Number.isFinite(at) || nowMs - at > LOOP_WINDOW_MS) continue
    let a = acc.get(e.terminalId)
    if (!a) acc.set(e.terminalId, (a = { failures: 0, calls: 0, tools: new Map(), since: '' }))
    if (e.kind === 'tool.started') {
      a.calls++
      continue
    }
    a.failures++
    if (!a.since || e.at < a.since) a.since = e.at
    const tool = e.data?.tool ?? ''
    a.tools.set(tool, (a.tools.get(tool) ?? 0) + 1)
  }
  const out = new Map<string, ErrorLoop>()
  for (const [id, a] of acc) {
    if (a.failures < LOOP_MIN_FAILURES || a.failures * 2 < a.calls) continue
    const top = [...a.tools].sort((x, y) => y[1] - x[1])[0]?.[0]
    out.set(id, { failures: a.failures, calls: Math.max(a.calls, a.failures), tool: top || null, since: a.since })
  }
  return out
}
