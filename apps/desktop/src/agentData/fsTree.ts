import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

export type EntryType = 'file' | 'dir' | 'link' | 'other'

export interface TreeEntry {
  rel: string
  type: EntryType
  size: number
  mtimeMs: number
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled')
  }
}

const check = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new Cancelled()
}

function typeOf(st: import('node:fs').Stats): EntryType {
  // lstat reports Windows junctions as symbolic links, so a junction is never walked into.
  if (st.isSymbolicLink()) return 'link'
  if (st.isDirectory()) return 'dir'
  if (st.isFile()) return 'file'
  return 'other'
}

/** Depth-first walk that never follows links; entries that vanish or can't be read are reported as `other`. */
export async function walkTree(root: string, onEntry: (e: TreeEntry) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
  const stack: string[] = ['']
  while (stack.length) {
    check(signal)
    const rel = stack.pop()!
    let names: string[]
    try {
      names = await fs.readdir(path.join(root, rel))
    } catch {
      continue
    }
    for (let i = 0; i < names.length; i += 64) {
      const chunk = names.slice(i, i + 64)
      const stats = await Promise.all(chunk.map((n) => fs.lstat(path.join(root, rel, n)).catch(() => null)))
      for (let j = 0; j < chunk.length; j++) {
        const st = stats[j]
        const childRel = rel ? path.join(rel, chunk[j]!) : chunk[j]!
        const type = st ? typeOf(st) : 'other'
        await onEntry({ rel: childRel, type, size: type === 'file' ? st!.size : 0, mtimeMs: st?.mtimeMs ?? 0 })
        if (type === 'dir') stack.push(childRel)
      }
    }
  }
}

export async function treeSize(root: string, signal?: AbortSignal, onFile?: (bytes: number) => void): Promise<{ files: number; bytes: number; newestMs: number | null }> {
  let files = 0
  let bytes = 0
  let newest = 0
  await walkTree(
    root,
    (e) => {
      if (e.type !== 'file') return
      files++
      bytes += e.size
      newest = Math.max(newest, e.mtimeMs)
      onFile?.(e.size)
    },
    signal,
  )
  return { files, bytes, newestMs: newest || null }
}

/** `\\?\C:\x\` (Windows junction readlink) → `C:\x`. */
export function cleanLinkTarget(target: string): string {
  let t = target.replace(/^\\\\\?\\/, '').replace(/^\\\?\?\\/, '')
  if (t.length > 3) t = t.replace(/[\\/]+$/, '')
  return t
}

/** Target of a junction / symlink at `p`, else null (also when `p` is missing). */
export async function linkTarget(p: string): Promise<string | null> {
  const st = await fs.lstat(p).catch(() => null)
  if (!st?.isSymbolicLink()) return null
  const raw = await fs.readlink(p).catch(() => null)
  return raw === null ? null : cleanLinkTarget(path.isAbsolute(raw) ? raw : path.resolve(path.dirname(p), raw))
}

export async function makeDirLink(target: string, at: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  // A junction needs no admin rights or Developer Mode on Windows, unlike a directory symlink.
  await fs.symlink(target, at, platform === 'win32' ? 'junction' : 'dir')
}

/** Removes only the link itself; refuses anything that is not a link. */
export async function removeLink(at: string): Promise<void> {
  const st = await fs.lstat(at)
  if (!st.isSymbolicLink()) throw new Error('not a link')
  try {
    await fs.unlink(at)
  } catch {
    await fs.rmdir(at)
  }
}

const BIG_FILE = 64 * 1024 * 1024

async function copyFileWithProgress(src: string, dst: string, onBytes: (n: number) => void, signal?: AbortSignal): Promise<void> {
  const st = await fs.stat(src)
  if (st.size < BIG_FILE) {
    await fs.copyFile(src, dst)
    onBytes(st.size)
  } else {
    const input = createReadStream(src)
    input.on('data', (chunk) => onBytes(chunk.length))
    await pipeline(input, createWriteStream(dst, { flags: 'wx' }), { signal })
  }
  await fs.utimes(dst, st.atime, st.mtime).catch(() => undefined)
}

export interface CopyResult {
  files: number
  bytes: number
  links: number
  /** Relative paths that could not be copied (sockets, locked files, file symlinks without the right). */
  skipped: string[]
}

/** Copies `src` into the new folder `dst`, keeping junctions / symlinks as links (never copying what they point to). */
export async function copyTree(src: string, dst: string, opts: { signal?: AbortSignal; onBytes?: (n: number) => void; platform?: NodeJS.Platform } = {}): Promise<CopyResult> {
  const platform = opts.platform ?? process.platform
  const out: CopyResult = { files: 0, bytes: 0, links: 0, skipped: [] }
  await fs.mkdir(dst)
  await walkTree(
    src,
    async (e) => {
      check(opts.signal)
      const from = path.join(src, e.rel)
      const to = path.join(dst, e.rel)
      try {
        if (e.type === 'dir') await fs.mkdir(to)
        else if (e.type === 'file') {
          await copyFileWithProgress(from, to, (n) => opts.onBytes?.(n), opts.signal)
          out.files++
          out.bytes += e.size
        } else if (e.type === 'link') {
          const target = await linkTarget(from)
          if (target === null) throw new Error('unreadable link')
          const isDir = await fs
            .stat(from)
            .then((s) => s.isDirectory())
            .catch(() => true)
          if (isDir) await makeDirLink(target, to, platform)
          else await fs.symlink(target, to, 'file')
          out.links++
        } else out.skipped.push(e.rel)
      } catch (err) {
        if (err instanceof Cancelled || opts.signal?.aborted) throw new Cancelled()
        out.skipped.push(e.rel)
      }
    },
    opts.signal,
  )
  return out
}

async function hashFile(file: string, size: number, signal?: AbortSignal): Promise<string> {
  const h = createHash('sha256')
  // Huge files: first and last 8 MB (with the size checked separately) keep the sample fast.
  const ranges = size > 256 * 1024 * 1024 ? [{ start: 0, end: 8 * 1024 * 1024 - 1 }, { start: size - 8 * 1024 * 1024, end: size - 1 }] : [{ start: 0, end: Math.max(0, size - 1) }]
  for (const r of size === 0 ? [] : ranges) {
    check(signal)
    for await (const chunk of createReadStream(file, r)) h.update(chunk as Buffer)
  }
  return h.digest('hex')
}

export interface VerifyResult {
  ok: boolean
  files: number
  bytes: number
  hashed: number
  /** First difference found (relative path). */
  mismatch?: string
}

/** Same files with the same sizes and the same links, and a sample of file hashes. */
export async function verifyCopy(src: string, dst: string, opts: { skipped?: readonly string[]; samples?: number; signal?: AbortSignal } = {}): Promise<VerifyResult> {
  const skipped = new Set(opts.skipped ?? [])
  const list = async (root: string): Promise<Map<string, TreeEntry>> => {
    const m = new Map<string, TreeEntry>()
    await walkTree(
      root,
      (e) => {
        if (e.type === 'file' || e.type === 'link') m.set(e.rel, e)
      },
      opts.signal,
    )
    return m
  }
  const a = await list(src)
  const b = await list(dst)
  let files = 0
  let bytes = 0
  for (const [rel, e] of a) {
    if (skipped.has(rel)) continue
    const c = b.get(rel)
    if (!c || c.type !== e.type || c.size !== e.size) return { ok: false, files, bytes, hashed: 0, mismatch: rel }
    if (e.type === 'file') {
      files++
      bytes += e.size
    }
  }
  for (const rel of b.keys()) if (!a.has(rel)) return { ok: false, files, bytes, hashed: 0, mismatch: rel }
  const all = [...a.values()].filter((e) => e.type === 'file' && !skipped.has(e.rel)).sort((x, y) => (x.rel < y.rel ? -1 : 1))
  const want = Math.min(opts.samples ?? 48, all.length)
  const picks = new Set<TreeEntry>()
  for (let i = 0; i < want; i++) picks.add(all[Math.floor((i * all.length) / want)]!)
  // The largest file is the one a bad copy is most likely to have cut.
  const largest = all.reduce<TreeEntry | null>((m, e) => (!m || e.size > m.size ? e : m), null)
  if (largest) picks.add(largest)
  let hashed = 0
  for (const e of picks) {
    const [x, y] = await Promise.all([hashFile(path.join(src, e.rel), e.size, opts.signal), hashFile(path.join(dst, e.rel), e.size, opts.signal)])
    if (x !== y) return { ok: false, files, bytes, hashed, mismatch: e.rel }
    hashed++
  }
  return { ok: true, files, bytes, hashed }
}

/** Deletes a folder tree; links inside are removed as links, their targets are never touched. */
export async function removeTree(root: string, opts: { signal?: AbortSignal; onFile?: (bytes: number) => void } = {}): Promise<{ files: number; bytes: number; failed: number }> {
  const out = { files: 0, bytes: 0, failed: 0 }
  const top = await fs.lstat(root).catch(() => null)
  if (!top) return out
  if (top.isSymbolicLink()) {
    await removeLink(root)
    return out
  }
  const dirs: string[] = []
  await walkTree(
    root,
    async (e) => {
      const p = path.join(root, e.rel)
      if (e.type === 'dir') return void dirs.push(p)
      try {
        if (e.type === 'link') await removeLink(p)
        else {
          await fs.unlink(p).catch(async (err: NodeJS.ErrnoException) => {
            if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err
            await fs.chmod(p, 0o666)
            await fs.unlink(p)
          })
          out.files++
          out.bytes += e.size
          opts.onFile?.(e.size)
        }
      } catch {
        out.failed++
      }
    },
    opts.signal,
  )
  for (const d of dirs.sort((x, y) => y.length - x.length)) await fs.rmdir(d).catch(() => undefined)
  await fs.rmdir(root).catch(() => {
    out.failed++
  })
  return out
}

/** True when `child` is `parent` or inside it (case-insensitive on Windows). */
export function isInsideOrSame(parent: string, child: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string): string => {
    const r = path.resolve(p)
    return platform === 'win32' ? r.toLowerCase() : r
  }
  const rel = path.relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
