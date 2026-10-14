import { statSync } from 'node:fs'
import path from 'node:path'

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** The hint itself when it is an existing folder, else its nearest existing ancestor; anything unusable → undefined (OS default). */
export function existingDir(near: unknown): string | undefined {
  if (typeof near !== 'string' || near.length > 1024 || /[\0-\x1f]/.test(near) || !path.isAbsolute(near)) return undefined
  for (let dir = path.resolve(near), parent = path.dirname(dir); ; dir = parent, parent = path.dirname(dir)) {
    if (isDir(dir)) return dir
    if (parent === dir) return undefined
  }
}

/**
 * Where "Choose folder…" opens: the parent of the last project, so it and its siblings are one click away.
 * A project that is gone falls back to its nearest existing ancestor.
 */
export function pickStartDir(near: unknown): string | undefined {
  const dir = existingDir(near)
  return dir !== undefined && typeof near === 'string' && dir === path.resolve(near) ? path.dirname(dir) : dir
}
