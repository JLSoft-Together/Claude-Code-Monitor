import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execGit } from './gitExec'

export type MergeKind = 'merge' | 'squash' | 'rebase' | 'cherry-pick' | 'revert'
export type MergeState = { ok: true; kind: MergeKind | null } | { ok: false; error: 'failed' }
export type AbortResult = { ok: true } | { ok: false; error: 'none' | 'cancelled' | 'failed'; detail?: string }

const exists = (p: string) => fs.stat(p).then(() => true, () => false)

/** What operation the checkout is in the middle of, from the marker files in its own git dir. */
export async function mergeState(root: string): Promise<MergeState> {
  const res = await execGit(root, ['rev-parse', '--absolute-git-dir'], { timeoutMs: 10_000, maxBytes: 8192 })
  if (res.code !== 0) return { ok: false, error: 'failed' }
  const dir = res.stdout.trim()
  if ((await exists(path.join(dir, 'rebase-merge'))) || (await exists(path.join(dir, 'rebase-apply')))) return { ok: true, kind: 'rebase' }
  if (await exists(path.join(dir, 'MERGE_HEAD'))) return { ok: true, kind: 'merge' }
  if (await exists(path.join(dir, 'CHERRY_PICK_HEAD'))) return { ok: true, kind: 'cherry-pick' }
  if (await exists(path.join(dir, 'REVERT_HEAD'))) return { ok: true, kind: 'revert' }
  if (await exists(path.join(dir, 'SQUASH_MSG'))) {
    // SQUASH_MSG also stays after a squash was committed; only unmerged entries mean a squash still in progress.
    const unmerged = await execGit(root, ['ls-files', '-u', '-z'], { timeoutMs: 10_000, maxBytes: 4096 })
    if (unmerged.stdout) return { ok: true, kind: 'squash' }
  }
  return { ok: true, kind: null }
}

export const abortCommands: Record<MergeKind, string[]> = {
  merge: ['merge', '--abort'],
  squash: ['reset', '--merge'],
  rebase: ['rebase', '--abort'],
  'cherry-pick': ['cherry-pick', '--abort'],
  revert: ['revert', '--abort'],
}

/** Abandons the operation in progress after `confirm` (shown the exact git command). */
export async function abortMerge(root: string, confirm: (kind: MergeKind, command: string) => Promise<boolean>): Promise<AbortResult> {
  const st = await mergeState(root)
  if (!st.ok) return { ok: false, error: 'failed' }
  if (!st.kind) return { ok: false, error: 'none' }
  const args = abortCommands[st.kind]
  if (!(await confirm(st.kind, `git ${args.join(' ')}`))) return { ok: false, error: 'cancelled' }
  const res = await execGit(root, args, { timeoutMs: 60_000 })
  return res.code === 0 ? { ok: true } : { ok: false, error: 'failed', detail: res.stderr.trim().slice(0, 400) }
}
