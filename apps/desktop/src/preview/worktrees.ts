import { isBranchName, parseWorktrees } from '../pty/git'
import { MAX_DIFF_BYTES, safeRepoPath } from './changes'
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
export type MergeResult = { ok: true; mode: MergeMode; hash: string } | { ok: false; error: WorktreeError; detail?: string; kept?: string }

const detail = (s: string): string => s.trim().split(/\r?\n/).slice(0, 4).join('\n').slice(0, 400)

/** Main checkout (first of `git worktree list`) and its branch, as seen from any checkout of the repo. */
export async function mainCheckout(dir: string): Promise<{ path: string; branch: string } | null> {
  const res = await execGit(dir, ['worktree', 'list', '--porcelain'], { timeoutMs: 15_000 })
  if (res.code !== 0) return null
  const main = parseWorktrees(res.stdout)[0]
  const real = main && (await realOrNull(main.path))
  return real && main.branch ? { path: real, branch: main.branch } : null
}

export async function knownBranch(dir: string, branch: unknown): Promise<string | null> {
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
export async function mergeBranch(
  dir: string,
  branchInput: unknown,
  mode: MergeMode,
  confirm: (commands: string[], target: string, base: string) => Promise<boolean>,
  keepConflicts = false,
): Promise<MergeResult> {
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
      const conflict = /conflict/i.test(res.stdout + res.stderr)
      // keepConflicts: the owner resolves in Changes, then commits (or aborts with `reset --merge`).
      if (conflict && keepConflicts) return { ok: false, error: 'conflict', detail: detail(res.stdout + res.stderr), kept: main.path }
      await execGit(main.path, ['reset', '--merge'], { timeoutMs: 30_000 })
      return { ok: false, error: conflict ? 'conflict' : 'failed', detail: detail(res.stdout + res.stderr) }
    }
    const staged = await execGit(main.path, ['diff', '--cached', '--quiet'], { timeoutMs: 15_000 })
    if (staged.code === 0) return { ok: false, error: 'empty' }
    const commit = await execGit(main.path, ['commit', '-q', '-F', '-'], { input: `Squash ${branch}\n`, timeoutMs: 180_000, killTree: true })
    if (commit.code !== 0) return { ok: false, error: 'failed', detail: detail(commit.stderr || commit.stdout) }
  }
  const head = await execGit(main.path, ['rev-parse', 'HEAD'], { maxBytes: 4096 })
  return { ok: true, mode, hash: head.stdout.trim() }
}

export type BetweenStatus = 'A' | 'M' | 'D' | 'T'
export interface BetweenFile {
  path: string
  status: BetweenStatus
  added: number
  removed: number
  binary: boolean
}
export type BetweenResult = { ok: true; a: string; b: string; files: BetweenFile[]; truncated: boolean } | { ok: false; error: WorktreeError; detail?: string }
export type BetweenDiff = { ok: true; text: string; tooLarge: boolean } | { ok: false; error: WorktreeError | 'denied'; detail?: string }
export type TakeResult = { ok: true } | { ok: false; error: WorktreeError | 'dirty' | 'missing'; detail?: string }

const MAX_BETWEEN = 1000

/** Files that differ between two branch tips (no merge base: best-of-N compares the results as they are). */
export async function diffBetween(dir: string, aInput: unknown, bInput: unknown): Promise<BetweenResult> {
  const [a, b] = await Promise.all([knownBranch(dir, aInput), knownBranch(dir, bInput)])
  if (!a || !b || a === b) return { ok: false, error: 'unknown' }
  const range = [`refs/heads/${a}`, `refs/heads/${b}`]
  const [names, nums] = await Promise.all([
    execGit(dir, ['diff', '--no-renames', '--name-status', '-z', ...range], { timeoutMs: 30_000 }),
    execGit(dir, ['diff', '--no-renames', '--numstat', '-z', ...range], { timeoutMs: 30_000 }),
  ])
  if (names.code !== 0) return { ok: false, error: 'failed', detail: detail(names.stderr) }
  const counts = new Map<string, { added: number; removed: number; binary: boolean }>()
  for (const rec of nums.stdout.split('\0')) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(rec)
    if (m) counts.set(m[3]!, { added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' })
  }
  const parts = names.stdout.split('\0')
  const files: BetweenFile[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]!.charAt(0) as BetweenStatus
    const path = parts[i + 1]!
    if (!path || !'AMDT'.includes(status)) continue
    files.push({ path, status, ...(counts.get(path) ?? { added: 0, removed: 0, binary: false }) })
  }
  return { ok: true, a, b, files: files.slice(0, MAX_BETWEEN), truncated: files.length > MAX_BETWEEN }
}

export async function fileBetween(dir: string, root: string, aInput: unknown, bInput: unknown, rel: unknown): Promise<BetweenDiff> {
  const [a, b] = await Promise.all([knownBranch(dir, aInput), knownBranch(dir, bInput)])
  const safe = safeRepoPath(root, rel)
  if (!a || !b) return { ok: false, error: 'unknown' }
  if (!safe) return { ok: false, error: 'denied' }
  const res = await execGit(dir, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', `refs/heads/${a}`, `refs/heads/${b}`, '--', safe.rel], { timeoutMs: 30_000, maxBytes: MAX_DIFF_BYTES })
  if (res.truncated) return { ok: true, text: '', tooLarge: true }
  if (res.code !== 0) return { ok: false, error: 'failed', detail: detail(res.stderr) }
  return { ok: true, text: res.stdout, tooLarge: false }
}

/** `git checkout <from> -- rel` in `root` (the pane's checkout), refused while that file has uncommitted changes. */
export async function takeFile(root: string, fromInput: unknown, rel: unknown, confirm: (commands: string[], from: string, rel: string) => Promise<boolean>): Promise<TakeResult> {
  const from = await knownBranch(root, fromInput)
  const safe = safeRepoPath(root, rel)
  if (!from || !safe) return { ok: false, error: 'unknown' }
  const exists = await execGit(root, ['cat-file', '-e', `refs/heads/${from}:${safe.rel}`], { maxBytes: 1024 })
  if (exists.code !== 0) return { ok: false, error: 'missing' }
  const dirty = await execGit(root, ['status', '--porcelain', '--', safe.rel], { timeoutMs: 20_000 })
  if (dirty.code !== 0) return { ok: false, error: 'failed', detail: detail(dirty.stderr) }
  if (dirty.stdout.trim()) return { ok: false, error: 'dirty' }
  if (!(await confirm([`cd ${root}`, `git checkout ${from} -- ${safe.rel}`], from, safe.rel))) return { ok: false, error: 'cancelled' }
  const res = await execGit(root, ['checkout', `refs/heads/${from}`, '--', safe.rel], { timeoutMs: 30_000 })
  return res.code === 0 ? { ok: true } : { ok: false, error: 'failed', detail: detail(res.stderr) }
}
