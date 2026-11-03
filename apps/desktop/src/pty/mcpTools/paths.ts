import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export const PATH_MAX = 4096
export const SEGMENTS_MAX = 64

export type InsideError = 'path' | 'outside' | 'missing' | 'folder'

const UNC = /^[\\/]{2}/
// `\\?\C:\…` is how Windows spells a junction to a local drive; any other `\\` target is a share or a device.
const REMOTE_LINK = /^[\\/]{2}(?![?.][\\/][A-Za-z]:[\\/])/
export const isRemoteLink = (to: string): boolean => REMOTE_LINK.test(to) || /^[\\/]{2}\?[\\/]UNC[\\/]/i.test(to)
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)\s*(\..*)?$/i

const inside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

/** No component below `root` may be a link to a share: realpath would already open it (SMB, NTLM hash). */
function remoteLinkBelow(root: string, target: string): boolean {
  const parts = path.relative(root, target).split(path.sep).filter(Boolean)
  let at = root
  for (const part of parts) {
    at = path.join(at, part)
    try {
      if (!lstatSync(at).isSymbolicLink()) continue
      const to = readlinkSync(at)
      if (isRemoteLink(to)) return true
    } catch {
      return false
    }
  }
  return false
}

/**
 * `raw` (absolute, or relative to `root`) as a real path to a file inside `root`. Symlinks / junctions are resolved
 * first, so a link inside the project pointing out of it is refused like `..` is. A missing file is allowed only
 * with `allowMissing`, judged by its deepest existing parent folder.
 */
export function resolveInside(root: string, raw: unknown, opts: { allowMissing?: boolean; platform?: string } = {}): { ok: true; path: string; exists: boolean } | { ok: false; error: InsideError } {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > PATH_MAX || /[\0\r\n]/.test(raw)) return { ok: false, error: 'path' }
  if (UNC.test(raw) || UNC.test(root)) return { ok: false, error: 'path' }
  const segments = raw.split(/[\\/]+/).filter(Boolean)
  if (segments.length > SEGMENTS_MAX) return { ok: false, error: 'path' }
  if ((opts.platform ?? process.platform) === 'win32' && segments.some((s) => DEVICE.test(s))) return { ok: false, error: 'path' }
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    return { ok: false, error: 'missing' }
  }
  const asked = path.resolve(realRoot, raw)
  if (!inside(asked, realRoot)) return { ok: false, error: 'outside' }
  if (remoteLinkBelow(realRoot, asked)) return { ok: false, error: 'path' }
  let real: string
  let exists = true
  try {
    real = realpathSync(asked)
  } catch {
    if (!opts.allowMissing) return { ok: false, error: 'missing' }
    exists = false
    let dir = path.dirname(asked)
    const rest = [path.basename(asked)]
    for (;;) {
      try {
        real = path.join(realpathSync(dir), ...rest)
        break
      } catch {
        const up = path.dirname(dir)
        if (up === dir || !inside(up, realRoot)) return { ok: false, error: 'missing' }
        rest.unshift(path.basename(dir))
        dir = up
      }
    }
  }
  if (UNC.test(real) || !inside(real, realRoot)) return { ok: false, error: 'outside' }
  if (exists) {
    try {
      const st = statSync(real)
      if (st.isDirectory()) return { ok: false, error: 'folder' }
      if (!st.isFile()) return { ok: false, error: 'path' }
    } catch {
      return { ok: false, error: 'missing' }
    }
  }
  return { ok: true, path: real, exists }
}

export function mtimeOf(file: string): number | undefined {
  try {
    const s = statSync(file)
    return s.isFile() ? Math.round(s.mtimeMs) : undefined
  } catch {
    return undefined
  }
}

/** Real path of `p`, or null when it cannot be resolved. */
export function realOf(p: string): string | null {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

export { inside as isInsideDir }
