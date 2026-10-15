import { reactive } from 'vue'
import { projectRootInfo } from '../lib/projects'
import { repoFacts, type RepoFacts } from '../lib/rail/repo'
import { containingRoot } from '../lib/sidebarRows'
import { dirKey } from '../stores/favorites'

// Shared by every caller: one `git rev-parse` per folder per window, one request in flight per folder.
const roots = reactive(new Map<string, string>())
/** dirKey(toplevel) -> toplevel, git repos only: a new pane inside one groups there before its own lookup returns. */
const repoRoots = reactive(new Map<string, string>())
/** dirKey(dir) -> repo facts, set together with `roots`. */
const facts = reactive(new Map<string, RepoFacts>())
/**
 * Remembered folders (no pane): read-only facts the host answers without registering the repo. Kept apart so a pane
 * opening there still runs its own lookup, which is what lets the host serve Changes / scripts for it.
 */
const recalled = reactive(new Map<string, RepoFacts>())
const inflight = new Map<string, Promise<string | null>>()
const recalling = new Set<string>()
/** dirKey -> when a pane lookup may run again. */
const failed = new Map<string, number>()
/** Remembered folders the host could not answer (gone, unreadable): tried once per window. */
const missed = new Set<string>()
// A pane's folder is refused until its PTY is up; the host re-reads its census on a miss, so short steps suffice.
const RETRY_MS = [150, 300, 600, 1200, 2500, 5000]
const FAILED_TTL_MS = 5000

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
        facts.set(key, repoFacts(info.root, info.repo, info.common))
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
    if (root) failed.delete(key)
    else failed.set(key, Date.now() + FAILED_TTL_MS)
  })
  return run
}

function recall(dir: string): void {
  const key = dirKey(dir)
  if (recalling.has(key) || missed.has(key)) return
  recalling.add(key)
  void projectRootInfo(dir, true).then((info) => {
    recalling.delete(key)
    if (info) recalled.set(key, repoFacts(info.root, info.repo, info.common))
    else missed.add(key)
  })
}

const blocked = (key: string): boolean => Date.now() < (failed.get(key) ?? 0)

/** Git toplevel of a pane folder via the desktop bridge; until it answers, the deepest known repo holding it. */
export function useProjectRoots() {
  function rootOf(dir: string): string | undefined {
    const key = dirKey(dir)
    const known = roots.get(key)
    if (known) return known
    if (!blocked(key)) void lookup(dir)
    return containingRoot(dir, repoRoots.values())
  }

  /** Resolved now; callers that act on the root (scripts, layouts) await it. */
  async function resolve(dir: string): Promise<string> {
    return (await lookup(dir)) ?? containingRoot(dir, repoRoots.values()) ?? dir
  }

  /** Repo facts of a folder once git answered; undefined while the lookup runs. `history`: a remembered folder, tried once. */
  function factsOf(dir: string, history = false): RepoFacts | undefined {
    const key = dirKey(dir)
    const known = facts.get(key)
    if (known || !history) {
      if (!known && !blocked(key)) void lookup(dir)
      return known
    }
    const old = recalled.get(key)
    if (!old) recall(dir)
    return old
  }

  return { rootOf, resolve, factsOf }
}
