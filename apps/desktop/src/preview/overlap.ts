import path from 'node:path'
import { commonDir } from './changes'
import { execGit } from './gitExec'
import { knownBranch, mainCheckout } from './worktrees'

const MAX_FILES = 2000

export type OverlapFiles =
  | { ok: true; root: string; common: string | null; branch: string | null; base: string | null; files: string[]; truncated: boolean }
  | { ok: false; error: 'not-repo' | 'failed' }

export type DryMerge = { ok: true; clean: boolean; conflicts: string[] } | { ok: false; error: 'unknown' | 'unsupported' | 'failed' | 'cancelled'; detail?: string }

const lines = (s: string): string[] => s.split('\0').filter(Boolean)

/**
 * Files this checkout changed against the main branch: committed since the merge base plus uncommitted
 * tracked edits (one `git diff` from the merge base to the working tree). The main checkout on its own
 * branch only reports its uncommitted files.
 */
export async function changedVsBase(root: string, signal?: AbortSignal): Promise<OverlapFiles> {
  const [main, head, common] = await Promise.all([
    mainCheckout(root),
    execGit(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { maxBytes: 4096, signal }),
    commonDir(root),
  ])
  const branch = head.code === 0 ? head.stdout.trim() || null : null
  if (!main && head.code === null) return { ok: false, error: 'not-repo' }
  let from = 'HEAD'
  if (main && branch !== main.branch) {
    const mb = await execGit(root, ['merge-base', `refs/heads/${main.branch}`, 'HEAD'], { maxBytes: 4096, timeoutMs: 15_000, signal })
    if (mb.code === 0 && mb.stdout.trim()) from = mb.stdout.trim()
  }
  const res = await execGit(root, ['diff', '--no-renames', '--name-only', '-z', from], { timeoutMs: 30_000, signal, maxBytes: 512 * 1024 })
  if (res.code !== 0 && !res.truncated) return { ok: false, error: res.code === null ? 'failed' : 'not-repo' }
  const files = lines(res.stdout)
  return { ok: true, root: path.resolve(root), common, branch, base: main?.branch ?? null, files: files.slice(0, MAX_FILES), truncated: res.truncated || files.length > MAX_FILES }
}

/** Would merging `b` into `a` conflict? `git merge-tree --write-tree` (git 2.38+) writes objects only, never the worktree or refs. */
export async function dryMerge(dir: string, aInput: unknown, bInput: unknown, signal?: AbortSignal): Promise<DryMerge> {
  const [a, b] = await Promise.all([knownBranch(dir, aInput), knownBranch(dir, bInput)])
  if (!a || !b || a === b) return { ok: false, error: 'unknown' }
  const res = await execGit(dir, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', `refs/heads/${a}`, `refs/heads/${b}`], { timeoutMs: 60_000, signal, maxBytes: 512 * 1024 })
  if (signal?.aborted) return { ok: false, error: 'cancelled' }
  if (res.code === 0) return { ok: true, clean: true, conflicts: [] }
  if (res.code === 1) return { ok: true, clean: false, conflicts: [...new Set(lines(res.stdout).slice(1))] }
  if (/usage: git merge-tree|unknown option|--write-tree/i.test(res.stderr)) return { ok: false, error: 'unsupported' }
  return { ok: false, error: 'failed', detail: res.stderr.trim().split(/\r?\n/).slice(0, 3).join('\n').slice(0, 300) }
}
