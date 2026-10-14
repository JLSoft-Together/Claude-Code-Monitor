import { reactive } from 'vue'
import { projectRootInfo } from '../lib/projects'
import { containingRoot } from '../lib/sidebarRows'
import { dirKey } from '../stores/favorites'

// Shared by every caller: one `git rev-parse` per folder per window, one request in flight per folder.
const roots = reactive(new Map<string, string>())
/** dirKey(toplevel) -> toplevel, git repos only: a new pane inside one groups there before its own lookup returns. */
const repoRoots = reactive(new Map<string, string>())
const inflight = new Map<string, Promise<string | null>>()
const failed = new Set<string>()
// A pane's folder is refused until its PTY is up; the host re-reads its census on a miss, so short steps suffice.
const RETRY_MS = [150, 300, 600, 1200, 2500, 5000]

function lookup(dir: string): Promise<string | null> {
  const key = dirKey(dir)
  const known = roots.get(key)
  if (known) return Promise.resolve(known)
  const pending = inflight.get(key)
  if (pending) return pending
  const run = (async (): Promise<string | null> => {
    for (let i = 0; ; i++) {
      const info = await projectRootInfo(dir)
      if (info) {
        roots.set(key, info.root)
        if (info.repo) repoRoots.set(dirKey(info.root), info.root)
        return info.root
      }
      if (i >= RETRY_MS.length) return null
      await new Promise((r) => setTimeout(r, RETRY_MS[i]))
    }
  })()
  inflight.set(key, run)
  void run.then((root) => {
    inflight.delete(key)
    if (!root) failed.add(key)
  })
  return run
}

/** Git toplevel of a pane folder via the desktop bridge; until it answers, the deepest known repo holding it. */
export function useProjectRoots() {
  function rootOf(dir: string): string | undefined {
    const key = dirKey(dir)
    const known = roots.get(key)
    if (known) return known
    if (!failed.has(key)) void lookup(dir)
    return containingRoot(dir, repoRoots.values())
  }

  /** Resolved now; callers that act on the root (scripts, layouts) await it. */
  async function resolve(dir: string): Promise<string> {
    return (await lookup(dir)) ?? containingRoot(dir, repoRoots.values()) ?? dir
  }

  return { rootOf, resolve }
}
