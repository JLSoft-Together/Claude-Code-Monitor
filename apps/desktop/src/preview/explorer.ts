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

export type RenameEntryResult =
  | { ok: true; path: string }
  | { ok: false; error: 'invalid'; reason: EntryNameProblem }
  | { ok: false; error: 'exists' | 'denied' | 'missing' | 'busy' | 'failed' }

export type TrashEntryResult = { ok: true } | { ok: false; error: 'denied' | 'missing' | 'busy' | 'exists' | 'failed' }

type FsFailure = 'busy' | 'denied' | 'missing' | 'exists' | 'failed'
const FS_CODES: Record<string, FsFailure> = { EPERM: 'busy', EBUSY: 'busy', EACCES: 'denied', ENOENT: 'missing', EEXIST: 'exists', ENOTEMPTY: 'exists' }

/**
 * Why a move failed. Windows reports a file/folder another process holds open (Run's flutter/gradle cwd, the Layout
 * watcher, an editor) as EPERM / EBUSY; Electron's trashItem gives only a message, so its code is read from there.
 */
export function fsFailure(err: unknown): FsFailure {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code && FS_CODES[code]) return FS_CODES[code]
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (/being used by another process/i.test(message)) return 'busy'
  const named = /\b(EPERM|EBUSY|EACCES|ENOENT|EEXIST|ENOTEMPTY)\b/.exec(message)?.[1]
  return named ? FS_CODES[named]! : 'failed'
}

/** `target` as its real parent folder (inside `root`) + its own name: a link at `target` itself is not followed, the root never qualifies. */
async function entryIn(root: string, target: unknown): Promise<string | null> {
  if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0')) return null
  const abs = path.normalize(target)
  const name = path.basename(abs)
  if (!name || name === '.' || name === '..' || target.split(/[\\/]/).includes('..')) return null
  const parent = await inside(root, path.dirname(abs))
  return parent ? path.join(parent, name) : null
}

/** Renames `target` to `name` in the same folder. Never overwrites; a case-only rename of the same file is allowed. */
export async function renameEntry(root: string, target: unknown, name: unknown): Promise<RenameEntryResult> {
  const check = checkEntryName(name)
  if (!check.ok) return { ok: false, error: 'invalid', reason: check.reason }
  const from = await entryIn(root, target)
  if (!from) return { ok: false, error: 'denied' }
  const stat = await fs.lstat(from, { bigint: true }).catch(() => null)
  if (!stat) return { ok: false, error: 'missing' }
  const dest = path.join(path.dirname(from), name as string)
  if (dest === from) return { ok: true, path: dest }
  const existing = await fs.lstat(dest, { bigint: true }).catch(() => null)
  // Case-insensitive disks (Windows, macOS) answer for `dest` with the same file: that is a case-only rename.
  // bigint: NTFS file ids overflow a double, so distinct files can compare equal as numbers.
  const sameFile = !!existing && dest.toLowerCase() === from.toLowerCase() && existing.ino === stat.ino && existing.dev === stat.dev
  if (existing && !sameFile) return { ok: false, error: 'exists' }
  try {
    await fs.rename(from, dest)
    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: fsFailure(err) }
  }
}

/** Moves `target` to the OS trash (`trash` = Electron `shell.trashItem`); never deletes outright. */
export async function trashEntry(root: string, target: unknown, trash: (p: string) => Promise<void>): Promise<TrashEntryResult> {
  const from = await entryIn(root, target)
  if (!from) return { ok: false, error: 'denied' }
  if (!(await fs.lstat(from).catch(() => null))) return { ok: false, error: 'missing' }
  try {
    await trash(from)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: fsFailure(err) }
  }
}
