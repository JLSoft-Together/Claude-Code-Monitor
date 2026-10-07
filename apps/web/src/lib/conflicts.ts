import type { TerminalSession } from '@ccm/shared'

export interface Conflict {
  /** Other live sessions in the same checkout (same repo root + branch). */
  others: string[]
  /** This session and at least one other are working right now. */
  hot: boolean
}

const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()

/** Sessions sharing one checkout can overwrite each other's edits; worktrees have their own root, so they never match. */
export function sessionConflicts(live: TerminalSession[], rootOf: (cwd: string) => string): Map<string, Conflict> {
  const groups = new Map<string, TerminalSession[]>()
  for (const x of live) {
    if (!x.cwd || x.status === 'stale') continue
    const key = `${norm(rootOf(x.cwd))}|${x.gitBranch ?? ''}`
    const list = groups.get(key)
    if (list) list.push(x)
    else groups.set(key, [x])
  }
  const out = new Map<string, Conflict>()
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const working = list.filter((x) => x.status === 'working').length
    for (const x of list) {
      out.set(x.id, { others: list.filter((o) => o.id !== x.id).map((o) => o.id), hot: x.status === 'working' && working >= 2 })
    }
  }
  return out
}
