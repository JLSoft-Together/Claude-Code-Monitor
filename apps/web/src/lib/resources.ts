import { RES_BUSY_GUARD_MS, type ResKillResult, type ResKillTarget, type ResKind, type ResourceReport, type ServerRes } from '@ccm/shared'
import { desktop } from './desktop'

interface ResBridge {
  resKill?: (targets: ResKillTarget[]) => Promise<ResKillResult>
}
const bridge = desktop as unknown as ResBridge | undefined

export const hasResKill = typeof bridge?.resKill === 'function'
export const resKill = (targets: ResKillTarget[]): Promise<ResKillResult> =>
  bridge?.resKill?.(targets).catch((): ResKillResult => ({ ok: false, error: 'failed' })) ?? Promise.resolve({ ok: false, error: 'unavailable' })

export type ResTab = 'sessions' | 'servers' | 'daemons' | 'ports'
export const RES_TABS: readonly ResTab[] = ['sessions', 'servers', 'daemons', 'ports']

export const isDaemonKind = (kind: ResKind): boolean => kind === 'daemon' || kind === 'emulator'

/** Daemons with CPU in the last 2 minutes are building; the desktop refuses to stop them. */
export function isBusyDaemon(s: Pick<ServerRes, 'kind' | 'lastBusyAt'>, now: number): boolean {
  return s.kind === 'daemon' && s.lastBusyAt !== null && now - s.lastBusyAt < RES_BUSY_GUARD_MS
}

export interface PortRow {
  key: string
  port: number
  address: string
  established: number
  pid: number
  name: string
  /** Owning server row; null for a process outside every agent tree (open / copy only). */
  server: ServerRes | null
  sessionId: string | null
}

export function portRows(report: ResourceReport | null): PortRow[] {
  if (!report) return []
  const rows: PortRow[] = []
  for (const s of report.servers) {
    for (const p of s.ports) rows.push({ key: `${s.pid}:${p.port}`, ...p, pid: s.pid, name: s.name, server: s, sessionId: s.sessionId })
  }
  for (const o of report.outside ?? []) {
    for (const p of o.ports) rows.push({ key: `${o.pid}:${p.port}`, ...p, pid: o.pid, name: o.name, server: null, sessionId: null })
  }
  return rows.sort((a, b) => Number(a.server === null) - Number(b.server === null) || a.port - b.port)
}

const byteFormats = new Map<string, Intl.NumberFormat>()

export function formatBytes(bytes: number | null | undefined, locale: string): string {
  if (bytes === null || bytes === undefined) return '—'
  const gb = bytes / 1024 ** 3
  const key = `${locale}|${gb >= 1 ? 1 : 0}`
  let f = byteFormats.get(key)
  if (!f) byteFormats.set(key, (f = new Intl.NumberFormat(locale, { maximumFractionDigits: gb >= 1 ? 1 : 0 })))
  return gb >= 1 ? `${f.format(gb)} GB` : `${f.format(bytes / 1024 ** 2)} MB`
}

export function formatCpu(pct: number | null | undefined, locale: string): string {
  if (pct === null || pct === undefined) return '—'
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: pct < 10 ? 1 : 0 }).format(pct)} %`
}

/** Idle spans run from minutes to days; seconds never matter. Feeds `resources.span.{min,hm,dh}`. */
export function spanParts(ms: number): { unit: 'min' | 'hm' | 'dh'; a: number; b: number } {
  const min = Math.max(0, Math.floor(ms / 60_000))
  if (min < 60) return { unit: 'min', a: min, b: 0 }
  const h = Math.floor(min / 60)
  if (h < 48) return { unit: 'hm', a: h, b: min % 60 }
  return { unit: 'dh', a: Math.floor(h / 24), b: h % 24 }
}

export const localUrl = (port: number): string => `http://localhost:${port}`
