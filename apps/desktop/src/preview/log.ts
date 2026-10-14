import { LOG_PAGE, type CommitFile, type CommitFileKind, type LocalRef, type LogCommit, type LogQuery, type LogRef, type RemoteGroup } from '@ccm/shared'
import { safeRepoPath } from './changes'

export const FS = '\x1f'
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s'].join('%x1f')
export const MAX_COMMIT_FILES = 5000
const MAX_PATHS = 20
const REF = /^refs\/(heads|remotes|tags)\/[^\s~^:?*[\\]+$/

export function parseLog(out: string): LogCommit[] {
  const commits: LogCommit[] = []
  for (const rec of out.split('\0')) {
    const f = rec.replace(/^\n/, '').split(FS)
    if (f.length < 7 || !f[0]) continue
    commits.push({ hash: f[0], parents: f[1] ? f[1].split(' ') : [], author: f[2]!, email: f[3]!, time: Number(f[4]) || 0, refs: f[5]!, subject: f.slice(6).join(FS) })
  }
  return commits
}

export function parseTrack(s: string): { ahead: number; behind: number; gone: boolean } {
  if (s.trim() === 'gone') return { ahead: 0, behind: 0, gone: true }
  return { ahead: Number(/ahead (\d+)/.exec(s)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(s)?.[1] ?? 0), gone: false }
}

/** `for-each-ref --format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)`. */
export function parseRefLines(out: string, remotes: string[]): { local: LocalRef[]; remotes: RemoteGroup[]; tags: LogRef[] } {
  const local: LocalRef[] = []
  const tags: LogRef[] = []
  const groups = new Map<string, LogRef[]>()
  // Longest first: a remote named `my/fork` must win over `my`.
  const names = [...remotes].sort((a, b) => b.length - a.length)
  for (const line of out.split('\n')) {
    const [ref, obj, peeled, upstream, track] = line.split(FS)
    if (!ref || !obj) continue
    const hash = peeled || obj
    if (ref.startsWith('refs/heads/')) local.push({ ref, name: ref.slice(11), hash, upstream: upstream || null, ...parseTrack(track ?? '') })
    else if (ref.startsWith('refs/tags/')) tags.push({ ref, name: ref.slice(10), hash })
    else if (ref.startsWith('refs/remotes/')) {
      const short = ref.slice(13)
      if (short.endsWith('/HEAD')) continue
      const remote = names.find((n) => short.startsWith(`${n}/`)) ?? short.split('/')[0]!
      const list = groups.get(remote) ?? []
      list.push({ ref, name: short, hash })
      groups.set(remote, list)
    }
  }
  const sorted = [...groups.keys()].sort((a, b) => a.localeCompare(b))
  return { local, remotes: sorted.map((name) => ({ name, refs: groups.get(name)! })), tags }
}

const KIND: Record<string, CommitFileKind> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechange' }

/** `diff-tree -r -z -M --name-status`: `X\0path\0`, renames / copies `R087\0old\0new\0`. */
export function parseNameStatus(out: string): CommitFile[] {
  const parts = out.split('\0')
  const files: CommitFile[] = []
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++]
    if (!status) continue
    const kind = KIND[status[0]!] ?? 'modified'
    if (kind === 'renamed' || kind === 'copied') {
      const origPath = parts[i++]!
      const p = parts[i++]
      if (p) files.push({ path: p, origPath, kind })
    } else {
      const p = parts[i++]
      if (p) files.push({ path: p, kind })
    }
  }
  return files
}

const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const epoch = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null)

export function cleanLogQuery(raw: unknown, root: string): LogQuery {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const branch = typeof o.branch === 'string' && (o.branch === 'HEAD' || (REF.test(o.branch) && !o.branch.includes('..') && !o.branch.endsWith('.lock'))) ? o.branch : null
  const paths = (Array.isArray(o.paths) ? o.paths : [])
    .map((p) => safeRepoPath(root, p)?.rel)
    .filter((p): p is string => !!p)
    .slice(0, MAX_PATHS)
  const skip = typeof o.skip === 'number' && Number.isFinite(o.skip) && o.skip > 0 ? Math.min(Math.floor(o.skip), 10_000_000) : 0
  return { branch, author: str(o.author, 200), since: epoch(o.since), until: epoch(o.until), text: str(o.text), regex: o.regex === true, matchCase: o.matchCase === true, paths, skip }
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const iso = (s: number): string => new Date(s * 1000).toISOString()

/** `git log` args; one extra row tells whether another page exists. */
export function logArgs(q: LogQuery): string[] {
  const args = ['log', '--topo-order', '-z', `--format=${LOG_FORMAT}`, `--skip=${q.skip}`, '-n', String(LOG_PAGE + 1)]
  if (q.author) args.push(`--author=${q.regex ? escapeRegex(q.author) : q.author}`)
  if (q.since) args.push(`--since=${iso(q.since)}`)
  if (q.until) args.push(`--until=${iso(q.until)}`)
  if (q.text) args.push(`--grep=${q.text}`)
  if (q.text || q.author) {
    args.push(q.regex ? '--extended-regexp' : '--fixed-strings')
    if (!q.matchCase) args.push('--regexp-ignore-case')
  }
  args.push(...(q.branch ? [q.branch] : ['--branches', '--remotes', '--tags', 'HEAD']), '--', ...q.paths)
  return args
}
