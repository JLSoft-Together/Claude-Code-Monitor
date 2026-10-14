import { promises as fs } from 'node:fs'
import path from 'node:path'
import { checkEntryName, type EntryNameProblem } from '@ccm/shared'
import { isWithin, realOrNull } from './paths'

export interface DirEntry {
  name: string
  /** Absolute: the listed folder's real path + name. */
  path: string
  directory: boolean
  /** Symlink resolving outside the project (or dangling): a leaf that does not open. */
  outOfRoot: boolean
}

export type CreateEntryResult =
  | { ok: true; path: string }
  | { ok: false; error: 'invalid'; reason: EntryNameProblem }
  | { ok: false; error: 'exists' | 'denied' | 'failed' }

const REALPATH_CONCURRENCY = 32

async function inside(root: string, target: string): Promise<string | null> {
  const real = await realOrNull(target)
  return real && isWithin(root, real) ? real : null
}

/** One folder of `root` (a real path), non-recursive and uncapped; null when `dir` is outside it or unreadable. */
export async function listDir(root: string, dir: unknown): Promise<DirEntry[] | null> {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || dir.includes('\0')) return null
  const real = await inside(root, dir)
  if (!real) return null
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(real, { withFileTypes: true })
  } catch {
    return null
  }
  const rows: DirEntry[] = new Array(entries.length)
  const links: number[] = []
  entries.forEach((e, i) => {
    if (e.isSymbolicLink()) links.push(i)
    else rows[i] = { name: e.name, path: path.join(real, e.name), directory: e.isDirectory(), outOfRoot: false }
  })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < links.length) {
      const i = links[next++]!
      const full = path.join(real, entries[i]!.name)
      const target = await realOrNull(full)
      const stat = target ? await fs.stat(target).catch(() => null) : null
      rows[i] = { name: entries[i]!.name, path: full, directory: !!stat?.isDirectory(), outOfRoot: !target || !isWithin(root, target) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REALPATH_CONCURRENCY, links.length) }, worker))
  return rows
}

/** New empty file or folder `name` in `parent` (inside `root`, a real path). Never overwrites. */
export async function createEntry(root: string, parent: unknown, name: unknown, kind: unknown): Promise<CreateEntryResult> {
  const check = checkEntryName(name)
  if (!check.ok) return { ok: false, error: 'invalid', reason: check.reason }
  if ((kind !== 'file' && kind !== 'directory') || typeof parent !== 'string' || !path.isAbsolute(parent)) return { ok: false, error: 'denied' }
  const dir = await inside(root, parent)
  if (!dir || !(await fs.stat(dir).catch(() => null))?.isDirectory()) return { ok: false, error: 'denied' }
  const dest = path.join(dir, name as string)
  if (!isWithin(dir, dest)) return { ok: false, error: 'denied' }
  try {
    if (kind === 'directory') await fs.mkdir(dest, { recursive: false })
    else await (await fs.open(dest, 'wx')).close()
    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: (err as NodeJS.ErrnoException).code === 'EEXIST' ? 'exists' : 'failed' }
  }
}
