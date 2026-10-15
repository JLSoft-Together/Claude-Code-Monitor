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
const inflight = new Map<string, { run: Promise<string | null>; retry: boolean }>()
/** dirKey -> when a pane lookup may run again; Infinity = a one-shot (history) miss, which pane lookups ignore. */
const failed = new Map<string, number>()
// A pane's folder is refused until its PTY is up; the host re-reads its census on a miss, so short steps suffice.
const RETRY_MS = [150, 300, 600, 1200, 2500, 5000]
const FAILED_TTL_MS = 5000

/** `retry` false: one try, for remembered folders the host refuses until a pane opens there. */
function lookup(dir: string, retry: boolean): Promise<string | null> {
  const key = dirKey(dir)
  const known = roots.get(key)
  if (known) return Promise.resolve(known)
  const pending = inflight.get(key)
  if (pending && (pending.retry || !retry)) return pending.run
  if (pending) return pending.run.then((root) => root ?? lookup(dir, true))
  const steps = retry ? RETRY_MS : []
  const run = (async (): Promise<string | null> => {
    for (let i = 0; ; i++) {
      const info = await projectRootInfo(dir)
      if (info) {
        roots.set(key, info.root)
        facts.set(key, repoFacts(info.root, info.repo, info.common))
        if (info.repo) repoRoots.set(dirKey(info.root), info.root)
        return info.root
      }
      if (i >= steps.length) return null
      await new Promise((r) => setTimeout(r, steps[i]))
    }
  })()
  inflight.set(key, { run, retry })
  void run.then((root) => {
    inflight.delete(key)
    if (root) failed.delete(key)
    else failed.set(key, retry ? Date.now() + FAILED_TTL_MS : Infinity)
  })
  return run
}

function blocked(key: string, retry: boolean): boolean {
  const until = failed.get(key)
  if (until === undefined) return false
  return retry ? until !== Infinity && Date.now() < until : true
}

/** Git toplevel of a pane folder via the desktop bridge; until it answers, the deepest known repo holding it. */
export function useProjectRoots() {
  function rootOf(dir: string): string | undefined {
    const key = dirKey(dir)
    const known = roots.get(key)
    if (known) return known
    if (!blocked(key, true)) void lookup(dir, true)
    return containingRoot(dir, repoRoots.values())
  }

  /** Resolved now; callers that act on the root (scripts, layouts) await it. */
  async function resolve(dir: string): Promise<string> {
    return (await lookup(dir, true)) ?? containingRoot(dir, repoRoots.values()) ?? dir
  }

  /** Repo facts of a folder once git answered; undefined while the lookup runs. `history`: a remembered folder, tried once. */
  function factsOf(dir: string, history = false): RepoFacts | undefined {
    const key = dirKey(dir)
    const known = facts.get(key)
    if (!known && !blocked(key, !history)) void lookup(dir, !history)
    return known
  }

  return { rootOf, resolve, factsOf }
}
