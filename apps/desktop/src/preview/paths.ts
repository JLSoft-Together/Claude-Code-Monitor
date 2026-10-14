import { promises as fs } from 'node:fs'
import path from 'node:path'

const foldCase = (p: string, platform: NodeJS.Platform): string => (platform === 'win32' ? p.toLowerCase() : p)

/** Lexical containment of two already-resolved paths; case-insensitive on Windows. */
export function isWithin(root: string, target: string, platform: NodeJS.Platform = process.platform): boolean {
  const r = foldCase(path.resolve(root), platform)
  const t = foldCase(path.resolve(target), platform)
  if (t === r) return true
  const prefix = r.endsWith(path.sep) ? r : r + path.sep
  return t.startsWith(prefix)
}

export const rootKey = (root: string, platform: NodeJS.Platform = process.platform): string => foldCase(path.resolve(root), platform)

export async function realOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p)
  } catch {
    return null
  }
}

export async function realRoots(roots: readonly string[]): Promise<string[]> {
  const out = await Promise.all(roots.filter((r) => typeof r === 'string' && path.isAbsolute(r)).map(realOrNull))
  return out.filter((r): r is string => r !== null)
}

/** Deepest root holding `target` (both real paths), so a project folder wins over a parent grant. */
export function rootOf(target: string, roots: readonly string[], platform: NodeJS.Platform = process.platform): string | null {
  let best: string | null = null
  for (const root of roots) if (isWithin(root, target, platform) && (!best || root.length > best.length)) best = root
  return best
}
