import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BUILD_DIR_NAMES, BUILD_SCAN_DEPTH, buildDirKind, needsReinstall, type BuildKind } from '@ccm/shared'
import { Cancelled } from '../agentData/fsTree'

export interface BuildCandidate {
  rel: string
  name: string
  kind: BuildKind
}

const NAMES: ReadonlySet<string> = new Set(BUILD_DIR_NAMES)
/** Folders never walked into: VCS data, and IDE / tool state that is no build output of the project. */
const SKIP = new Set(['.git', '.hg', '.svn', '.idea', '.vscode', '.cxx', '.externalNativeBuild'])
const MAX_DIRS = 20_000

/** Drive roots and the home folder are refused as projects: a scan there would reach into unrelated folders. */
export function refusedRoot(root: string, home: string = os.homedir(), platform: NodeJS.Platform = process.platform): boolean {
  const r = path.resolve(root)
  const norm = (p: string) => (platform === 'win32' ? p.toLowerCase().replace(/[\\/]+$/, '') : p.replace(/\/+$/, ''))
  return path.parse(r).root === r || norm(r) === norm(path.resolve(home))
}

/** Build folders up to BUILD_SCAN_DEPTH below `root`; links / junctions are never followed or offered, nor walked into once matched. */
export async function findBuildDirs(root: string, git: boolean, signal?: AbortSignal): Promise<BuildCandidate[]> {
  const out: BuildCandidate[] = []
  const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }]
  let seen = 0
  while (queue.length && seen < MAX_DIRS) {
    if (signal?.aborted) throw new Cancelled()
    const { rel, depth } = queue.shift()!
    seen++
    const names = await fs.readdir(path.join(root, rel)).catch(() => [] as string[])
    const siblings = new Set(names.map((n) => n.toLowerCase()))
    const stats = await Promise.all(names.map((n) => fs.lstat(path.join(root, rel, n)).catch(() => null)))
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!
      const st = stats[i]
      if (!st || st.isSymbolicLink() || !st.isDirectory()) continue
      const childRel = rel ? `${rel}/${name}` : name
      const known = NAMES.has(name)
      const kind = known ? buildDirKind(name, siblings, git) : null
      if (kind) {
        out.push({ rel: childRel, name, kind })
        continue
      }
      if (name === 'node_modules' || SKIP.has(name) || depth + 1 >= BUILD_SCAN_DEPTH) continue
      queue.push({ rel: childRel, depth: depth + 1 })
    }
  }
  return out
}

export type GitRun = (cwd: string, args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>

export async function isGitWorkTree(root: string, git: GitRun): Promise<boolean> {
  const r = await git(root, ['rev-parse', '--is-inside-work-tree'])
  return r.ok && r.stdout.trim() === 'true'
}

const CHUNK = 100

/** Keeps candidates git ignores and that hold no tracked file; a git failure keeps none (never guess in a repo). */
export async function gitIgnoredOnly(root: string, cands: readonly BuildCandidate[], git: GitRun): Promise<BuildCandidate[]> {
  const ignored = new Set<string>()
  for (let i = 0; i < cands.length; i += CHUNK) {
    const part = cands.slice(i, i + CHUNK)
    // `-z` needs --stdin; one path per line instead, unquoted. Exit 1 = none ignored; anything on stderr is a real failure.
    const r = await git(root, ['-c', 'core.quotePath=false', 'check-ignore', '--', ...part.map((c) => `${c.rel}/`)])
    if (!r.ok && r.stderr.trim()) return []
    for (const p of r.stdout.split(/\r?\n/)) if (p) ignored.add(p.replace(/\/+$/, ''))
  }
  const kept = cands.filter((c) => ignored.has(c.rel))
  const tracked = new Set<string>()
  for (let i = 0; i < kept.length; i += CHUNK) {
    const part = kept.slice(i, i + CHUNK)
    const r = await git(root, ['ls-files', '-z', '--', ...part.map((c) => c.rel)])
    if (!r.ok) return []
    for (const f of r.stdout.split('\0')) {
      const owner = part.find((c) => f === c.rel || f.startsWith(`${c.rel}/`))
      if (owner) tracked.add(owner.rel)
    }
  }
  return kept.filter((c) => !tracked.has(c.rel))
}

export const reinstallOf = (c: BuildCandidate): boolean => needsReinstall(c.name)
