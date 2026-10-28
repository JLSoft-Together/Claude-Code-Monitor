import type { TerminalSession } from '@ccm/shared'
import { dirKey } from '../stores/favorites'
import { folderName, projectOf } from './sidebarRows'

export interface ProjectGroup {
  key: string
  name: string
  dir: string
  sessions: number
  waiting: number
  working: number
  /** Sum of the status-line cost of these sessions; absent when none reported one. */
  costUsd?: number
  ids: string[]
}

export const NO_PROJECT = '~'

/** Live sessions per repo (worktrees fold into their repo), busiest first. */
export function projectGroups(list: readonly TerminalSession[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>()
  for (const s of list) {
    if (s.status === 'stale' || s.endedAt) continue
    const dir = projectOf(s.cwd)
    const key = dir ? dirKey(dir) : NO_PROJECT
    let g = map.get(key)
    if (!g) {
      g = { key, name: dir ? folderName(dir) : '', dir: dir ?? '', sessions: 0, waiting: 0, working: 0, ids: [] }
      map.set(key, g)
    }
    g.sessions++
    g.ids.push(s.id)
    if (s.status === 'waiting') g.waiting++
    else if (s.status === 'working') g.working++
    if (typeof s.costUsd === 'number' && Number.isFinite(s.costUsd)) g.costUsd = (g.costUsd ?? 0) + s.costUsd
  }
  return [...map.values()].sort(
    (a, b) => b.waiting - a.waiting || b.sessions - a.sessions || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

export function sameGroups(a: readonly ProjectGroup[] | undefined, b: readonly ProjectGroup[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]!
    return (
      x.key === y.key &&
      x.sessions === y.sessions &&
      x.waiting === y.waiting &&
      x.working === y.working &&
      x.costUsd === y.costUsd &&
      x.ids.length === y.ids.length &&
      x.ids.every((id, j) => id === y.ids[j])
    )
  })
}
