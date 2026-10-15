import { checkBranchName, type BranchOpError, type BranchOpResult } from '@ccm/shared'
import { execGit, type GitExecResult } from './gitExec'
import { REF } from './log'

const LOCAL = { timeoutMs: 20_000 }
const NET = { timeoutMs: 120_000, killTree: true }

/** First stderr line, with `user:token@` removed from URLs: git prints remote URLs it failed on. */
export function sanitizeGitError(stderr: string): string {
  const line = stderr.split(/\r?\n/).find((l) => l.trim()) ?? ''
  return line.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1').slice(0, 300)
}

export function failed(res: GitExecResult, fallback: BranchOpError = 'failed'): BranchOpResult {
  if (res.timedOut) return { ok: false, error: 'timeout' }
  const s = res.stderr
  // code null without a timeout = git missing or spawn error: never a git verdict like non-ff.
  if (res.code === null) return { ok: false, error: 'failed', detail: sanitizeGitError(s) }
  const error: BranchOpError = /not fully merged/i.test(s)
    ? 'not-merged'
    : /already exists/i.test(s)
      ? 'exists'
      : /Authentication failed|could not read Username|Permission denied|\b403\b.*(?:Forbidden|error)|returned error: 403/i.test(s)
        ? 'auth'
        : /non-fast-forward|Not possible to fast-forward|rejected/i.test(s)
          ? 'non-ff'
          : /would be overwritten|conflict/i.test(s)
            ? 'conflict'
            : fallback
  return { ok: false, error, detail: sanitizeGitError(s) }
}

const validRef = (ref: unknown): ref is string => typeof ref === 'string' && (ref === 'HEAD' || (REF.test(ref) && !ref.includes('..') && !ref.endsWith('.lock')))

async function currentBranch(root: string): Promise<string | null> {
  const res = await execGit(root, ['symbolic-ref', '-q', '--short', 'HEAD'], LOCAL)
  return res.code === 0 ? res.stdout.trim() || null : null
}

/** New branch `name` at `base` (a listed ref, `HEAD` or a commit hash); `checkout` switches to it (`git switch -c`). */
export async function createBranch(root: string, name: unknown, base: unknown, checkout: unknown): Promise<BranchOpResult> {
  if (!checkBranchName(name).ok) return { ok: false, error: 'invalid' }
  const fmt = await execGit(root, ['check-ref-format', '--branch', name as string], LOCAL)
  if (fmt.code !== 0) return { ok: false, error: 'invalid' }
  const baseOk = validRef(base) || (typeof base === 'string' && /^[0-9a-f]{4,64}$/.test(base))
  if (!baseOk) return { ok: false, error: 'invalid' }
  const verify = await execGit(root, ['rev-parse', '--verify', '-q', `${base as string}^{commit}`], LOCAL)
  if (verify.code !== 0) return { ok: false, error: 'invalid' }
  const start = verify.stdout.trim()
  const res = checkout === true ? await execGit(root, ['switch', '-c', name as string, start], LOCAL) : await execGit(root, ['branch', '--', name as string, start], LOCAL)
  return res.code === 0 ? { ok: true } : failed(res)
}

/**
 * Exact git argv for deleting `ref`: local `branch -d|-D -- <name>`, remote `push <remote> --delete refs/heads/<branch>`
 * (fully qualified so a same-named tag on the remote is never the one deleted).
 * Never the current branch, never tags. The caller shows `args` in a native confirm before `runDelete`.
 */
export async function deletePlan(
  root: string,
  ref: unknown,
  force: boolean,
): Promise<{ ok: true; args: string[]; remote: boolean; label: string } | { ok: false; error: BranchOpError }> {
  if (!validRef(ref) || ref === 'HEAD' || ref.startsWith('refs/tags/')) return { ok: false, error: 'denied' }
  if (ref.startsWith('refs/heads/')) {
    const name = ref.slice('refs/heads/'.length)
    if (!checkBranchName(name).ok) return { ok: false, error: 'denied' }
    if ((await currentBranch(root)) === name) return { ok: false, error: 'current' }
    return { ok: true, args: ['branch', force ? '-D' : '-d', '--', name], remote: false, label: name }
  }
  const short = ref.slice('refs/remotes/'.length)
  const remotes = (await execGit(root, ['remote'], LOCAL)).stdout.split(/\r?\n/).filter(Boolean)
  const remote = remotes.filter((r) => short.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
  const branch = remote ? short.slice(remote.length + 1) : ''
  if (!remote || !branch || branch === 'HEAD' || !checkBranchName(branch).ok) return { ok: false, error: 'denied' }
  return { ok: true, args: ['push', remote, '--delete', `refs/heads/${branch}`], remote: true, label: short }
}

export async function runDelete(root: string, args: string[]): Promise<BranchOpResult> {
  const res = await execGit(root, args, args[0] === 'push' ? NET : LOCAL)
  return res.code === 0 ? { ok: true } : failed(res)
}

/** `git fetch --all` (no prune): new branches and commits from every remote. */
export async function fetchAll(root: string): Promise<BranchOpResult> {
  let res = await execGit(root, ['fetch', '--all', '--no-write-fetch-head'], NET)
  // git < 2.29 has no --no-write-fetch-head.
  if (res.code !== 0 && !res.timedOut && /unknown option.*no-write-fetch-head/i.test(res.stderr)) res = await execGit(root, ['fetch', '--all'], NET)
  return res.code === 0 ? { ok: true } : failed(res)
}

/**
 * Update Selected (fast-forward only): the current branch via `pull --ff-only`; another tracked local branch via
 * `fetch <remote> <branch>:refs/heads/<local>`, which git refuses when it is not a fast-forward.
 */
export async function updateBranch(root: string, ref: unknown): Promise<BranchOpResult> {
  if (!validRef(ref) || !ref.startsWith('refs/heads/')) return { ok: false, error: 'denied' }
  const local = ref.slice('refs/heads/'.length)
  const up = await execGit(root, ['for-each-ref', '--format=%(upstream:remotename)%1f%(upstream:remoteref)', ref], LOCAL)
  const [remote, remoteRef] = up.stdout.trim().split('\x1f')
  if (!remote || !remoteRef?.startsWith('refs/heads/')) return { ok: false, error: 'no-upstream' }
  const res =
    (await currentBranch(root)) === local
      ? await execGit(root, ['pull', '--ff-only', '--no-rebase'], NET)
      : await execGit(root, ['fetch', remote, `${remoteRef}:${ref}`], NET)
  return res.code === 0 ? { ok: true } : failed(res)
}
