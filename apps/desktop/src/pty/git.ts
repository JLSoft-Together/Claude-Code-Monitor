import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { PtyWorktree } from '../../../../packages/shared/src/pty'

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

// Our own PATH lookup: libuv would try the child's cwd first, and that cwd is a project folder we do not control.
export function findGit(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const names = platform === 'win32' ? ['git.exe'] : ['git']
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => d && path.isAbsolute(d))
  if (platform !== 'win32') dirs.push('/usr/bin', '/usr/local/bin', '/opt/homebrew/bin')
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name)
      try {
        if (statSync(file).isFile()) return file
      } catch {
        // not here
      }
    }
  }
  return null
}

let gitPath: string | null | undefined

export function runGit(cwd: string, args: string[], timeoutMs = 30_000): Promise<GitResult> {
  gitPath ??= findGit()
  const file = gitPath
  if (!file) return Promise.resolve({ ok: false, stdout: '', stderr: 'git not found' })
  return new Promise((resolve) => {
    execFile(
      file,
      ['-C', cwd, ...args],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }),
    )
  })
}

export const hasGit = (): boolean => (gitPath ??= findGit()) !== null

export function parseWorktrees(porcelain: string): PtyWorktree[] {
  const out: PtyWorktree[] = []
  for (const block of porcelain.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean)
    const wt = lines.find((l) => l.startsWith('worktree '))
    if (!wt) continue
    const branch = lines.find((l) => l.startsWith('branch '))?.slice(7)
    out.push({
      path: path.normalize(wt.slice(9)),
      branch: branch?.replace(/^refs\/heads\//, ''),
      head: lines.find((l) => l.startsWith('HEAD '))?.slice(5) ?? '',
      main: out.length === 0,
      locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      prunable: lines.some((l) => l === 'prunable' || l.startsWith('prunable ')),
    })
  }
  return out
}

/**
 * Conservative subset of git's ref rules (check-ref-format): no leading dash (would read as an option),
 * no "..", "@{", control chars, spaces or the characters git forbids.
 */
export function isBranchName(name: string): boolean {
  if (!name || name.length > 200 || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false
  if (name.includes('..') || name.includes('@{') || name.includes('//') || name === '@') return false
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false
  return name.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'))
}

/** `<repo>-wt/<branch>` next to the main checkout; slashes in the branch become dashes. */
export function worktreeDest(mainPath: string, branch: string): string {
  const repo = path.resolve(mainPath)
  return path.join(path.dirname(repo), `${path.basename(repo)}-wt`, branch.replace(/\//g, '-'))
}

export const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Branch from a HEAD file's content; short commit id when detached. */
export function branchOfHead(content: string): string | null {
  const text = content.trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text)
  if (ref) return ref[1]!
  return /^[0-9a-f]{7,64}$/i.test(text) ? text.slice(0, 7) : null
}

export function readHeadBranch(gitDir: string): string | null {
  try {
    return branchOfHead(readFileSync(path.join(gitDir, 'HEAD'), 'utf8'))
  } catch {
    return null
  }
}

export const isDir = (p: string): boolean => {
  try {
    return existsSync(p) && statSync(p).isDirectory()
  } catch {
    return false
  }
}
