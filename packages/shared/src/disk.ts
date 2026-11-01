// Low disk space watch (v77 R9): desktop main measures the drives Orrery and the agents write to.

export const DISK_WARN_CHOICES = [0, 5, 10, 20, 50] as const
export const DEFAULT_DISK_WARN_GB = 10
export const DISK_DANGER_GB = 2
export const DISK_WARN_PCT = 5
/** An alerted drive alerts again only after climbing this far above the threshold (no flapping on a busy build). */
export const DISK_REARM_GB = 1
export const DISK_CHECK_MS = 10 * 60_000

const GB = 1024 ** 3

export type DiskLevel = 'ok' | 'warn' | 'danger'
export type DiskPlace = 'claude' | 'codex' | 'data' | 'capture' | 'project' | 'android'

export interface DiskDrive {
  /** Mount point (`C:\`, `/`, `/Volumes/X`). */
  mount: string
  /** `C:` or the mount point. */
  label: string
  freeBytes: number
  totalBytes: number
  level: DiskLevel
  places: DiskPlace[]
}

export interface DiskState {
  /** 0 = off. */
  warnGb: number
  at: number | null
  drives: DiskDrive[]
}

export function diskLevel(free: number, total: number, warnGb: number): DiskLevel {
  if (warnGb <= 0) return 'ok'
  if (free < DISK_DANGER_GB * GB) return 'danger'
  if (free < warnGb * GB || (total > 0 && (free / total) * 100 < DISK_WARN_PCT)) return 'warn'
  return 'ok'
}

export function diskRearmed(free: number, total: number, warnGb: number): boolean {
  return free >= Math.max(warnGb * GB, (total * DISK_WARN_PCT) / 100) + DISK_REARM_GB * GB
}

/** Desktop → collector: show the `disk` toast (and the phone message when `danger`), quiet hours applied there. */
export interface DiskAlertMessage {
  type: 'disk.alert'
  label: string
  level: 'warn' | 'danger'
  freeBytes: number
  totalBytes: number
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function parseDiskAlert(raw: unknown): DiskAlertMessage | null {
  const r = raw as Partial<DiskAlertMessage> | null
  if (!r || typeof r !== 'object' || r.type !== 'disk.alert') return null
  if (typeof r.label !== 'string' || !r.label || r.label.length > 200 || /[\u0000-\u001f]/.test(r.label)) return null
  if (r.level !== 'warn' && r.level !== 'danger') return null
  if (!num(r.freeBytes) || !num(r.totalBytes)) return null
  return { type: 'disk.alert', label: r.label, level: r.level, freeBytes: r.freeBytes, totalBytes: r.totalBytes }
}

export const isDiskWarnGb = (v: unknown): v is number => (DISK_WARN_CHOICES as readonly unknown[]).includes(v)

export function formatGb(bytes: number): string {
  const gb = bytes / GB
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`
}
