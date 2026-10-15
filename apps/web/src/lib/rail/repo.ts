import { dirKey } from '../../stores/favorites'
import { folderName } from '../sidebarRows'

export interface RepoFacts {
  /** Cluster key: `repo:<common dir>` for git repos (worktrees share it), `plain:<folder>` otherwise. */
  key: string
  /** Checkout toplevel (or the folder itself when not a repo). */
  top: string
  /** Main checkout of the repo; null for a bare repo or a plain folder. */
  main: string | null
  repo: boolean
}

export function mainCheckout(common: string): string | null {
  if (folderName(common) !== '.git') return null
  const i = Math.max(common.lastIndexOf('/'), common.lastIndexOf('\\'))
  return i > 0 ? common.slice(0, i) : null
}

export function repoFacts(top: string, repo: boolean, common?: string): RepoFacts {
  if (!repo) return { key: `plain:${dirKey(top)}`, top, main: null, repo: false }
  if (!common) return { key: `repo:${dirKey(top)}`, top, main: top, repo: true }
  return { key: `repo:${dirKey(common)}`, top, main: mainCheckout(common), repo: true }
}
