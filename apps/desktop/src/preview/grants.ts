import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { rootKey } from './paths'

export const GRANTS_FILE = 'preview-grants.json'
export const MAX_GRANTS = 100
export const FULL_ACCESS_FILE = 'preview-full-access.json'

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Absolute, existing, below a filesystem root: what may be granted or kept. */
const usable = (dir: unknown): dir is string => typeof dir === 'string' && path.isAbsolute(dir) && path.dirname(dir) !== dir && !/^[\\/]{2}/.test(dir) && isDir(dir)

/**
 * Folders the user allowed (access prompt, folder / file pickers), newest first. Persisted so a restored browser
 * or file tab outside every terminal folder opens again after a restart; without a file it lives until quit.
 */
export class GrantStore {
  private dirs: string[] = []

  constructor(private readonly file?: string) {
    if (!file) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
      const list = Array.isArray(raw) ? raw : []
      const seen = new Set<string>()
      for (const dir of list) {
        if (!usable(dir) || seen.has(rootKey(dir))) continue
        seen.add(rootKey(dir))
        this.dirs.push(dir)
        if (this.dirs.length >= MAX_GRANTS) break
      }
      // Folders that disappeared are dropped from the file too.
      if (this.dirs.length !== list.length) this.save()
    } catch {
      // missing or unreadable: start empty
    }
  }

  list(): readonly string[] {
    return this.dirs
  }

  add(dir: string): void {
    if (!usable(dir)) return
    const key = rootKey(dir)
    this.dirs = [dir, ...this.dirs.filter((d) => rootKey(d) !== key)].slice(0, MAX_GRANTS)
    this.save()
  }

  clear(): void {
    this.dirs = []
    this.save()
  }

  private save(): void {
    if (!this.file) return
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.dirs, null, 2))
      renameSync(tmp, this.file)
    } catch {
      // read-only data dir: grants just do not survive a restart
    }
  }
}

/** Settings switch: every folder readable without asking. Off unless the file says so; only the app turns it on, after a native confirm. */
export class FullAccess {
  private on = false
  // No file yet (first run, or the data dir was reset): the workspace asks once.
  private decided = false

  constructor(private readonly file?: string) {
    if (!file) return
    try {
      const full = (JSON.parse(readFileSync(file, 'utf8')) as { full?: unknown }).full
      this.on = full === true
      this.decided = typeof full === 'boolean'
    } catch {
      // missing or unreadable: off, not decided
    }
  }

  get(): boolean {
    return this.on
  }

  asked(): boolean {
    return this.decided
  }

  set(on: boolean): void {
    this.on = on
    this.decided = true
    if (!this.file) return
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify({ full: on }))
    } catch {
      // read-only data dir: the switch lasts until quit
    }
  }
}

let drives: { at: number; list: string[] } | null = null

/** Drive roots (Windows letters that exist) or `/`: what full access adds to the allowed roots. Cached 30 s: an unreachable mapped drive is slow to probe. */
export function filesystemRoots(platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== 'win32') return ['/']
  if (!drives || Date.now() - drives.at > 30_000) {
    drives = { at: Date.now(), list: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => `${l}:\\`).filter((r) => existsSync(r)) }
  }
  return drives.list
}
