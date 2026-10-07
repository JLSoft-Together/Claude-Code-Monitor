import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type RootProbe = (dir: string) => Promise<boolean>

const hasGit: RootProbe = async (dir) => {
  try {
    await stat(path.join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/**
 * Maps a working directory to the nearest ancestor holding `.git` (dir or worktree file).
 * Dirs without a repo, or that no longer exist, map to themselves.
 */
export class RepoRoots {
  private readonly probes = new Map<string, Promise<boolean>>()
  private readonly roots = new Map<string, string>()

  private readonly stops: Set<string>

  /** `stopAt`: ancestors never used as a root (a dotfiles repo in home would swallow every project). */
  constructor(
    private readonly probe: RootProbe = hasGit,
    stopAt: string[] = [os.homedir()],
  ) {
    this.stops = new Set(stopAt.map((d) => path.resolve(d).toLowerCase()))
  }

  known(dir: string): boolean {
    return this.roots.has(dir)
  }

  async resolve(dir: string): Promise<string> {
    const cached = this.roots.get(dir)
    if (cached) return cached
    let root = dir
    if (path.isAbsolute(dir)) {
      const start = path.resolve(dir)
      let current = start
      for (;;) {
        if (current !== start && (this.stops.has(current.toLowerCase()) || path.dirname(current) === current)) break
        if (await this.probeOnce(current)) {
          root = current === start ? dir : current
          break
        }
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
      }
    }
    this.roots.set(dir, root)
    return root
  }

  private probeOnce(dir: string): Promise<boolean> {
    const key = dir.toLowerCase()
    let p = this.probes.get(key)
    if (!p) {
      p = this.probe(dir)
      this.probes.set(key, p)
    }
    return p
  }
}
