import { execFile } from 'node:child_process'
import type { GitDiffStat } from '@ccm/shared'

export function parseShortstat(out: string): { files: number; insertions: number; deletions: number } {
  const n = (re: RegExp) => Number(out.match(re)?.[1] ?? 0)
  return { files: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?\(\+\)/), deletions: n(/(\d+) deletions?\(-\)/) }
}

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      // Optional locks off: a status read must never contend with the session's own git commands for index.lock.
      { timeout: 5_000, windowsHide: true, maxBuffer: 1_000_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout) => resolve(err ? null : String(stdout)),
    )
  })
}

/** Uncommitted tracked changes vs HEAD plus untracked entries (folders count once); null outside a repo. */
export async function readDiffStat(cwd: string, now: number = Date.now()): Promise<GitDiffStat | null> {
  const shortstat = await git(cwd, ['diff', '--shortstat', 'HEAD'])
  if (shortstat === null) return null
  const others = await git(cwd, ['ls-files', '--others', '--exclude-standard', '--directory', '--no-empty-directory'])
  const untracked = others === null ? 0 : others.split('\n').filter((l) => l.trim()).length
  return { ...parseShortstat(shortstat), untracked, at: new Date(now).toISOString() }
}
