import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execGit } from './gitExec'
import { isWithin, rootKey } from './paths'

export const MAX_LIST = 50_000
const WALK_IGNORE = new Set(['node_modules', '.git', 'dist', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.venv', '__pycache__', '.gradle', '.idea', 'coverage'])
// Unwatched roots refresh after this; watched ones are dropped on the first change event.
const TTL_MS = 30_000

export interface FileList {
  root: string
  /** Relative to `root`, `/` separators. */
  files: string[]
  truncated: boolean
  source: 'git' | 'walk'
}

/** Paths from `git ls-files -co --exclude-standard -z` (relative to cwd, so a sub-folder lists only itself). */
export function parseLsFiles(out: string, max = MAX_LIST): { files: string[]; truncated: boolean } {
  const seen = new Set<string>()
  const files: string[] = []
  for (const p of out.split('\0')) {
    if (!p || seen.has(p)) continue
    if (files.length >= max) return { files, truncated: true }
    seen.add(p)
    files.push(p)
  }
  return { files, truncated: false }
}

export async function walkFiles(root: string, max = MAX_LIST): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  const queue: string[] = ['']
  while (queue.length) {
    const rel = queue.shift()!
    const dirents = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    for (const d of dirents) {
      const child = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        if (!WALK_IGNORE.has(d.name)) queue.push(child)
      } else if (d.isFile()) {
        if (files.length >= max) return { files, truncated: true }
        files.push(child)
      }
    }
  }
  return { files, truncated: false }
}

export async function listFiles(root: string, max = MAX_LIST): Promise<FileList> {
  // Upper bound on raw output: 50k paths of a generous average length.
  const res = await execGit(root, ['ls-files', '-co', '--exclude-standard', '-z'], { maxBytes: max * 260, timeoutMs: 20_000 })
  if (res.code === 0) return { root, ...parseLsFiles(res.stdout, max), source: 'git' }
  return { root, ...(await walkFiles(root, max)), source: 'walk' }
}

/** Per-root cache; concurrent requests share one listing. */
export class FileListCache {
  private entries = new Map<string, { at: number; job: Promise<FileList> }>()

  constructor(private readonly list: (root: string) => Promise<FileList> = listFiles, private readonly now: () => number = Date.now) {}

  get(root: string): Promise<FileList> {
    const key = rootKey(root)
    const hit = this.entries.get(key)
    if (hit && this.now() - hit.at < TTL_MS) return hit.job
    const job = this.list(root)
    const entry = { at: this.now(), job }
    this.entries.set(key, entry)
    job.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    })
    return job
  }

  /** Drops every cached listing that overlaps `changedRoot` (a parent or child folder). */
  invalidate(changedRoot: string): void {
    for (const key of [...this.entries.keys()]) if (isWithin(key, changedRoot) || isWithin(changedRoot, key)) this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}
