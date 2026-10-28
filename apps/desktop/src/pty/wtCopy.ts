import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

const MAX_FILE = 1024 * 1024
const MAX_TOTAL = 5 * 1024 * 1024
const MAX_DEPTH = 4
const MAX_PATTERNS = 20
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', '.gradle', '.dart_tool', 'dist', 'out', '.idea', 'Pods', '.venv'])

export const DEFAULT_WORKTREE_COPY = ['.env*', 'local.properties', 'key.properties', '**/google-services.json']

interface Pattern {
  deep: boolean
  re: RegExp
}

/** `name`, `prefix*` or `**\/name`: a file name glob, at the top level or (with `**\/`) in any folder up to 4 deep. */
export function parsePatterns(input: unknown): Pattern[] {
  if (!Array.isArray(input)) return []
  const out: Pattern[] = []
  for (const raw of input.slice(0, MAX_PATTERNS)) {
    if (typeof raw !== 'string') continue
    const deep = raw.startsWith('**/')
    const name = deep ? raw.slice(3) : raw
    if (!name || name.length > 100 || /[\\/:]/.test(name) || name === '.' || name === '..' || /^\*+$/.test(name)) continue
    const re = new RegExp(`^${name.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/\\\\]*')}$`, 'i')
    out.push({ deep, re })
  }
  return out
}

async function walk(dir: string, rel: string, depth: number, patterns: Pattern[], found: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isFile() && patterns.some((p) => p.re.test(e.name) && (p.deep || depth === 0))) found.push(r)
    else if (e.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(e.name) && patterns.some((p) => p.deep)) await walk(path.join(dir, e.name), r, depth + 1, patterns, found)
    if (found.length > 200) return
  }
}

/**
 * Copies matching files from the main checkout into a fresh worktree when the worktree has none there yet
 * (tracked files are already checked out, so only untracked / ignored ones like `.env` get copied). Never
 * overwrites; skips links and files over 1 MB; stops at 5 MB in total. Returns the relative paths copied.
 */
export async function copySetupFiles(mainPath: string, dest: string, input: unknown): Promise<string[]> {
  const patterns = parsePatterns(input)
  if (!patterns.length) return []
  const found: string[] = []
  await walk(mainPath, '', 0, patterns, found)
  const copied: string[] = []
  let total = 0
  for (const rel of found) {
    const from = path.join(mainPath, rel)
    const to = path.join(dest, rel)
    const stat = await fs.lstat(from).catch(() => null)
    if (!stat?.isFile() || stat.size > MAX_FILE || total + stat.size > MAX_TOTAL) continue
    if (await fs.lstat(to).catch(() => null)) continue
    try {
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.copyFile(from, to, constants.COPYFILE_EXCL)
      copied.push(rel)
      total += stat.size
    } catch {
      continue
    }
  }
  return copied
}
