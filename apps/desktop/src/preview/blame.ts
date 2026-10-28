import path from 'node:path'
import { execGit } from './gitExec'

export interface BlameCommit {
  author: string
  time: number
  summary: string
}

export type BlameResult =
  /** `lines[i]` = commit hash of line i + 1, '' = not committed yet. */
  | { ok: true; root: string; commits: Record<string, BlameCommit>; lines: string[] }
  | { ok: false; error: 'denied' | 'not-repo' | 'untracked' | 'too-large' | 'cancelled' | 'failed'; detail?: string }

const MAX_BYTES = 16 * 1024 * 1024
const ZERO = /^0{40}$/
const HEAD_LINE = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/

/** Parses `git blame --porcelain` (each commit's header comes once, on its first line). */
export function parseBlame(out: string): { commits: Record<string, BlameCommit>; lines: string[] } {
  const commits: Record<string, BlameCommit> = {}
  const lines: string[] = []
  let hash = ''
  let line = 0
  for (const raw of out.split('\n')) {
    const head = HEAD_LINE.exec(raw)
    if (head) {
      hash = ZERO.test(head[1]!) ? '' : head[1]!
      line = Number(head[2])
      if (hash && !commits[hash]) commits[hash] = { author: '', time: 0, summary: '' }
      continue
    }
    if (raw.startsWith('\t')) {
      lines[line - 1] = hash
      continue
    }
    const c = hash ? commits[hash] : undefined
    if (!c) continue
    if (raw.startsWith('author ')) c.author = raw.slice(7).slice(0, 80)
    else if (raw.startsWith('author-time ')) c.time = Number(raw.slice(12)) * 1000 || 0
    else if (raw.startsWith('summary ')) c.summary = raw.slice(8).slice(0, 200)
  }
  for (let i = 0; i < lines.length; i++) lines[i] ??= ''
  return { commits, lines }
}

/** Blame of the working-tree file `abs` inside `root` (uncommitted lines come back as ''). */
export async function blame(root: string, abs: string, signal?: AbortSignal): Promise<BlameResult> {
  const rel = path.relative(root, abs).split(path.sep).join('/')
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: 'denied' }
  const res = await execGit(root, ['blame', '--porcelain', '--', rel], { timeoutMs: 30_000, maxBytes: MAX_BYTES, signal })
  if (signal?.aborted) return { ok: false, error: 'cancelled' }
  if (res.truncated) return { ok: false, error: 'too-large' }
  if (res.code !== 0) return { ok: false, error: /no such path|not in HEAD|no such ref/i.test(res.stderr) ? 'untracked' : 'failed', detail: res.stderr.trim().slice(0, 300) }
  return { ok: true, root, ...parseBlame(res.stdout) }
}
