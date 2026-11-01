import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const RUN_STATE_FILE = 'run-state.json'

export interface PreviousRun {
  /** The last run never reached a confirmed quit: crash, power loss, logoff or a Windows Update restart. */
  unclean: boolean
}

export function readPreviousRun(file: string): PreviousRun {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { running?: unknown } | null
    return { unclean: raw?.running === true }
  } catch {
    return { unclean: false }
  }
}

function write(file: string, running: boolean, now: number): void {
  try {
    writeFileSync(file, JSON.stringify({ running, at: new Date(now).toISOString() }))
  } catch {
    // data dir unwritable: the next start just cannot tell a crash from a quit
  }
}

export const markRunning = (file: string, now = Date.now()): void => write(file, true, now)
export const markClean = (file: string, now = Date.now()): void => write(file, false, now)

const MAX_DIRS = 200

/** Which of the page's absolute folders still exist; anything malformed or a UNC path counts as missing. */
export function dirsExist(raw: unknown): boolean[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_DIRS) return null
  return raw.map((p) => {
    if (typeof p !== 'string' || p.length > 1024 || !path.isAbsolute(p) || /^[\\/]{2}/.test(p)) return false
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  })
}
