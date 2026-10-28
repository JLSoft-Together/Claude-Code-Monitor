import { isBranchName, parseWorktrees } from '../pty/git'
import { execGit } from './gitExec'
import { realOrNull } from './paths'

export type MergeMode = 'ff' | 'squash'

export interface WorktreeCompare {
  ok: true
  base: string
  branch: string
  /** Commits on the branch the base lacks / on the base the branch lacks. */
  ahead: number
  behind: number
  files: number
  added: number
  removed: number
  /** The branch tip is already in the base. */
  merged: boolean
}

export type WorktreeError = 'denied' | 'not-repo' | 'unknown' | 'dirty-base' | 'not-ff' | 'conflict' | 'cancelled' | 'failed' | 'empty'
export type CompareResult = WorktreeCompare | { ok: false; error: WorktreeError; detail?: string }
export type MergeResult = { ok: true; mode: MergeMode; hash: string } | { ok: false; error: WorktreeError; detail?: string }

const detail = (s: string): string => s.trim().split(/\r?\n/).slice(0, 4).join('\n').slice(0, 400)

/** Main checkout (first of `git worktree list`) and its branch, as seen from any checkout of the repo. */
export async function mainCheckout(dir: string): Promise<{ path: string; branch: string } | null> {
  const res = await execGit(dir, ['worktree', 'list', '--porcelain'], { timeoutMs: 15_000 })
  if (res.code !== 0) return null
  const main = parseWorktrees(res.stdout)[0]
  const real = main && (await realOrNull(main.path))
  return real && main.branch ? { path: real, branch: main.branch } : null
}

async function knownBranch(dir: string, branch: unknown): Promise<string | null> {
  if (typeof branch !== 'string' || !isBranchName(branch)) return null
  const res = await execGit(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { maxBytes: 1024 })
  return res.code === 0 ? branch : null
}

export async function compareBranch(dir: string, branchInput: unknown): Promise<CompareResult> {
  const main = await mainCheckout(dir)
  if (!main) return { ok: false, error: 'not-repo' }
  const branch = await knownBranch(dir, branchInput)
  if (!branch || branch === main.branch) return { ok: false, error: 'unknown' }
  const counts = await execGit(dir, ['rev-list', '--left-right', '--count', `refs/heads/${main.branch}...refs/heads/${branch}`], { maxBytes: 4096 })
  if (counts.code !== 0) return { ok: false, error: 'failed', detail: detail(counts.stderr) }
  const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/).map(Number)
  const stat = await execGit(dir, ['diff', '--shortstat', `refs/heads/${main.branch}...refs/heads/${branch}`], { maxBytes: 4096, timeoutMs: 20_000 })
  const n = (re: RegExp): number => Number(re.exec(stat.stdout)?.[1] ?? 0)
  return {
    ok: true,
    base: main.branch,
    branch,
    ahead,
    behind,
    files: n(/(\d+) files? changed/),
    added: n(/(\d+) insertions?/),
    removed: n(/(\d+) deletions?/),
    merged: ahead === 0,
  }
}

export function mergeCommands(base: string, branch: string, mode: MergeMode): string[] {
  return mode === 'ff' ? [`git switch ${base}`, `git merge --ff-only ${branch}`] : [`git switch ${base}`, `git merge --squash ${branch}`, `git commit -m "Squash ${branch}"`]
}

/**
 * Brings `branch` into the main checkout's branch. Only fast-forward or squash; a dirty main checkout or a
 * conflict stops with nothing committed (a failed squash is undone with `reset --merge`).
 */
export async function mergeBranch(dir: string, branchInput: unknown, mode: MergeMode, confirm: (commands: string[], target: string, base: string) => Promise<boolean>): Promise<MergeResult> {
  const main = await mainCheckout(dir)
  if (!main) return { ok: false, error: 'not-repo' }
  const branch = await knownBranch(dir, branchInput)
  if (!branch || branch === main.branch) return { ok: false, error: 'unknown' }
  const dirty = await execGit(main.path, ['status', '--porcelain', '--untracked-files=no'], { timeoutMs: 20_000 })
  if (dirty.code !== 0) return { ok: false, error: 'failed', detail: detail(dirty.stderr) }
  if (dirty.stdout.trim()) return { ok: false, error: 'dirty-base' }
  if (!(await confirm(mergeCommands(main.branch, branch, mode), main.path, main.branch))) return { ok: false, error: 'cancelled' }
  if (mode === 'ff') {
    const res = await execGit(main.path, ['merge', '--ff-only', '--no-edit', `refs/heads/${branch}`], { timeoutMs: 120_000 })
    if (res.code !== 0) return { ok: false, error: /not possible to fast-forward|fatal: Not possible/i.test(res.stderr) ? 'not-ff' : 'failed', detail: detail(res.stderr) }
  } else {
    const res = await execGit(main.path, ['merge', '--squash', `refs/heads/${branch}`], { timeoutMs: 120_000 })
    if (res.code !== 0) {
      await execGit(main.path, ['reset', '--merge'], { timeoutMs: 30_000 })
      return { ok: false, error: /conflict/i.test(res.stdout + res.stderr) ? 'conflict' : 'failed', detail: detail(res.stdout + res.stderr) }
    }
    const staged = await execGit(main.path, ['diff', '--cached', '--quiet'], { timeoutMs: 15_000 })
    if (staged.code === 0) return { ok: false, error: 'empty' }
    const commit = await execGit(main.path, ['commit', '-q', '-F', '-'], { input: `Squash ${branch}\n`, timeoutMs: 180_000, killTree: true })
    if (commit.code !== 0) return { ok: false, error: 'failed', detail: detail(commit.stderr || commit.stdout) }
  }
  const head = await execGit(main.path, ['rev-parse', 'HEAD'], { maxBytes: 4096 })
  return { ok: true, mode, hash: head.stdout.trim() }
}
