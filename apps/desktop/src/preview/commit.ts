import { hunkPatchFor, safeRepoPath, type ChangesError } from './changes'
import { execGit } from './gitExec'

export type CommitError = ChangesError | 'nothing' | 'empty-message' | 'pushed' | 'cancelled' | 'hook' | 'timeout'
export type StageResult = { ok: true } | { ok: false; error: CommitError; detail?: string }
export type CommitResult = { ok: true; hash: string; subject: string } | { ok: false; error: CommitError; detail?: string }

const detail = (s: string): string => s.trim().slice(0, 600)
const MAX_PATHS = 500
const MAX_MESSAGE = 20_000

function cleanPaths(root: string, input: unknown): string[] | null {
  const list = Array.isArray(input) ? input : [input]
  if (!list.length || list.length > MAX_PATHS) return null
  const out: string[] = []
  for (const p of list) {
    const safe = safeRepoPath(root, p)
    if (!safe) return null
    out.push(safe.rel)
  }
  return out
}

/** `git add -A -- paths`: modified, new and deleted files alike. */
export async function stagePaths(root: string, paths: unknown): Promise<StageResult> {
  const rels = cleanPaths(root, paths)
  if (!rels) return { ok: false, error: 'denied' }
  const res = await execGit(root, ['add', '-A', '--', ...rels], { timeoutMs: 30_000 })
  return res.code === 0 ? { ok: true } : { ok: false, error: 'failed', detail: detail(res.stderr) }
}

/** Index back to HEAD for these paths; the working tree is never touched. */
export async function unstagePaths(root: string, paths: unknown): Promise<StageResult> {
  const rels = cleanPaths(root, paths)
  if (!rels) return { ok: false, error: 'denied' }
  const head = await execGit(root, ['rev-parse', '--verify', '-q', 'HEAD'], { maxBytes: 4096 })
  const args = head.code === 0 ? ['restore', '--staged', '--', ...rels] : ['rm', '--cached', '-q', '-r', '--ignore-unmatch', '--', ...rels]
  const res = await execGit(root, args, { timeoutMs: 30_000 })
  return res.code === 0 ? { ok: true } : { ok: false, error: 'failed', detail: detail(res.stderr) }
}

/** Applies one hunk of the HEAD → worktree diff to the index; `--check` first, so a hunk that no longer fits changes nothing. */
export async function stageHunk(root: string, relInput: unknown, patch: unknown): Promise<StageResult> {
  const safe = safeRepoPath(root, relInput)
  if (!safe) return { ok: false, error: 'denied' }
  const text = hunkPatchFor(safe.rel, patch)
  if (!text) return { ok: false, error: 'denied' }
  const args = ['apply', '--cached', '--whitespace=nowarn']
  const check = await execGit(root, [...args, '--check', '-'], { input: text })
  if (check.code !== 0) return { ok: false, error: 'stale', detail: detail(check.stderr) }
  const res = await execGit(root, [...args, '-'], { input: text })
  return res.code === 0 ? { ok: true } : { ok: false, error: 'failed', detail: detail(res.stderr) }
}

/** True when no remote-tracking branch holds HEAD, so rewriting it cannot break a push. */
export async function headUnpushed(root: string): Promise<boolean> {
  const head = await execGit(root, ['rev-parse', '--verify', '-q', 'HEAD'], { maxBytes: 4096 })
  if (head.code !== 0) return false
  const res = await execGit(root, ['branch', '-r', '--contains', 'HEAD', '--format=%(refname)'], { maxBytes: 64 * 1024, timeoutMs: 15_000 })
  return res.code === 0 && !res.stdout.trim()
}

export interface CommitOptions {
  amend: boolean
}

export function cleanCommit(input: unknown): { message: string; opts: CommitOptions } | null {
  const o = (input ?? {}) as { message?: unknown; amend?: unknown }
  if (typeof o.message !== 'string' || o.message.length > MAX_MESSAGE || o.message.includes('\0')) return null
  return { message: o.message.replace(/\r\n/g, '\n'), opts: { amend: o.amend === true } }
}

/**
 * Commits what is staged. Repo hooks run (no `--no-verify`); the message goes through stdin, never argv.
 * Amend is refused once HEAD is on a remote; the caller asks the user before calling with `amend`.
 */
export async function commit(root: string, message: string, opts: CommitOptions, signal?: AbortSignal): Promise<CommitResult> {
  if (!message.trim()) return { ok: false, error: 'empty-message' }
  if (opts.amend && !(await headUnpushed(root))) return { ok: false, error: 'pushed' }
  if (!opts.amend) {
    const staged = await execGit(root, ['diff', '--cached', '--quiet'], { timeoutMs: 15_000 })
    if (staged.code === 0) return { ok: false, error: 'nothing' }
  }
  const args = ['commit', '-q', '--cleanup=strip', '-F', '-', ...(opts.amend ? ['--amend'] : [])]
  const res = await execGit(root, args, { input: message, timeoutMs: 180_000, killTree: true, signal })
  if (signal?.aborted) return { ok: false, error: 'cancelled' }
  if (res.timedOut) return { ok: false, error: 'timeout' }
  if (res.code !== 0) {
    const err = detail(res.stderr || res.stdout)
    return { ok: false, error: /hook/i.test(err) ? 'hook' : 'failed', detail: err }
  }
  const head = await execGit(root, ['log', '-1', '--format=%H%x00%s'], { maxBytes: 16_384 })
  const [hash = '', subject = ''] = head.stdout.trim().split('\0')
  return { ok: true, hash, subject }
}
