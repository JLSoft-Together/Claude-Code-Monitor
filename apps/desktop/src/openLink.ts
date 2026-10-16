import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { isAgentSessionId, isPtyPreset, type PaneOpenError, type PaneOpenResult, type PtyPreset } from '../../../packages/shared/src/pty'

export interface OpenLink {
  preset: PtyPreset
  cwd: string
  resume?: string
}

const UNC = /^[\\/]{2}/
const CONTROL = /[\x00-\x1f\x7f-\x9f]/
const WIN_DRIVE = /^[A-Za-z]:[\\/]/
const CWD_MAX = 1024
const LINK_RATE_MAX = 10
const LINK_RATE_MS = 60_000
const PANE_OPEN_ERRORS: readonly PaneOpenError[] = ['unavailable', 'limit', 'cwd', 'preset', 'rate', 'failed', 'resume', 'live']

export function parseOpenLink(raw: string, platform: NodeJS.Platform): OpenLink | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'agent-monitor:' || url.hostname !== 'open') return null
  const preset = url.searchParams.get('agent') ?? 'claude'
  const cwd = url.searchParams.get('cwd')
  if (!isPtyPreset(preset) || !cwd || cwd.length > CWD_MAX || CONTROL.test(cwd) || UNC.test(cwd)) return null
  const absolute = platform === 'win32' ? WIN_DRIVE.test(cwd) && path.win32.isAbsolute(cwd) : path.posix.isAbsolute(cwd)
  if (!absolute) return null
  const resume = url.searchParams.get('resume')
  if (resume === null) return { preset, cwd }
  return preset !== 'shell' && isAgentSessionId(resume) ? { preset, cwd, resume } : null
}

export function realDir(dir: string): string | null {
  if (UNC.test(dir)) return null
  try {
    const real = realpathSync(dir)
    return !UNC.test(real) && statSync(real).isDirectory() ? real : null
  } catch {
    return null
  }
}

export function paneOpenResult(raw: unknown): PaneOpenResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'failed' }
  const r = raw as { ok?: unknown; paneKey?: unknown; error?: unknown }
  if (r.ok === true && typeof r.paneKey === 'string') return { ok: true, paneKey: r.paneKey }
  if (r.ok === false && PANE_OPEN_ERRORS.includes(r.error as PaneOpenError)) return { ok: false, error: r.error as PaneOpenError }
  return { ok: false, error: 'failed' }
}

export function takeLinkSlot(times: number[], now: number, max = LINK_RATE_MAX, windowMs = LINK_RATE_MS): boolean {
  while (times.length && now - times[0]! >= windowMs) times.shift()
  if (times.length >= max) return false
  times.push(now)
  return true
}
