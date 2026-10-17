import type { LogCommit } from './gitlog'

export type BranchNameProblem = 'empty' | 'space' | 'dash' | 'dots' | 'char' | 'slash' | 'lock' | 'long'

/** Quick check mirroring `git check-ref-format --branch` (main runs git's own check too). */
export function checkBranchName(name: unknown): { ok: true } | { ok: false; reason: BranchNameProblem } {
  if (typeof name !== 'string' || !name) return { ok: false, reason: 'empty' }
  if (name.length > 200) return { ok: false, reason: 'long' }
  if (/\s/.test(name)) return { ok: false, reason: 'space' }
  if (name.startsWith('-')) return { ok: false, reason: 'dash' }
  if (name.includes('..') || name.includes('@{') || name === '@') return { ok: false, reason: 'dots' }
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) return { ok: false, reason: 'char' }
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//') || name.endsWith('.') || /(^|\/)\./.test(name)) return { ok: false, reason: 'slash' }
  if (/\.lock(\/|$)/.test(name)) return { ok: false, reason: 'lock' }
  return { ok: true }
}

export type BranchOpError =
  | 'denied'
  | 'invalid'
  | 'exists'
  | 'not-merged'
  | 'current'
  | 'conflict'
  | 'no-upstream'
  | 'non-ff'
  | 'remote-rejected'
  | 'no-remote'
  | 'auth'
  | 'timeout'
  | 'cancelled'
  | 'failed'

/** `detail`: one sanitized line of git's stderr (no credentials). */
export type BranchOpResult = { ok: true; detail?: string } | { ok: false; error: BranchOpError; detail?: string }

/** Max outgoing commits a push preview lists. */
export const PUSH_PREVIEW_MAX = 100

/**
 * Push dialog model (v54): what `git push` would send from local branch `local` to `<remote>/<branch>`.
 * `exists` = the remote-tracking ref is known (else a new branch on the remote); `upstream` = the target is the
 * configured upstream; `hasUpstream` = the local branch has one at all.
 */
export type PushPreview =
  | {
      ok: true
      local: string
      remotes: string[]
      remote: string
      branch: string
      upstream: boolean
      hasUpstream: boolean
      exists: boolean
      commits: LogCommit[]
      more: boolean
    }
  | { ok: false; error: BranchOpError; detail?: string }

/**
 * Exact `git push` argv for the dialog's choices. Main builds it from validated parts and runs it; the page uses the
 * same function only to show the command. Never `--force*`, `--delete`, `--mirror`, `--all` or `--tags`.
 */
export function pushArgs(local: string, remote: string, branch: string, setUpstream: boolean): string[] {
  return ['push', '--porcelain', ...(setUpstream ? ['--set-upstream'] : []), remote, `refs/heads/${local}:refs/heads/${branch}`]
}
