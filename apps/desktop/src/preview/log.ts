import { isHash, LOG_PAGE, type CommitDetail, type CommitFile, type CommitFileKind, type ContainsResult, type LocalRef, type LogCommit, type LogError, type LogPageResult, type LogQuery, type LogRef, type RefsResult, type RemoteGroup } from '@ccm/shared'
import { cleanDiffOptions, diffArgs, emptyTree, MAX_DIFF_BYTES, MAX_FULL_DIFF_BYTES, parseNumstat, safeRepoPath, type ChangesDiff, type DiffOptions } from './changes'
import { execGit, type GitExecResult } from './gitExec'

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

const T = { timeoutMs: 20_000 }
const fail = (res: GitExecResult): LogError => (res.code === null && res.stderr === 'git not found' ? 'no-git' : 'failed')

export async function listRefs(root: string): Promise<RefsResult> {
  const [refs, remotes, branch, head, me] = await Promise.all([
    execGit(root, ['for-each-ref', `--format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)`, 'refs/heads', 'refs/remotes', 'refs/tags'], T),
    execGit(root, ['remote'], T),
    execGit(root, ['symbolic-ref', '-q', '--short', 'HEAD'], T),
    execGit(root, ['rev-parse', '-q', '--verify', 'HEAD'], T),
    execGit(root, ['config', 'user.name'], T),
  ])
  if (refs.code !== 0) return { ok: false, error: fail(refs) }
  const parsed = parseRefLines(refs.stdout, remotes.stdout.split('\n').filter(Boolean))
  return {
    ok: true,
    root,
    head: { branch: branch.code === 0 ? branch.stdout.trim() || null : null, hash: head.code === 0 ? head.stdout.trim() || null : null },
    ...parsed,
    me: me.code === 0 ? me.stdout.trim() || null : null,
  }
}

async function resolveCommit(root: string, hash: unknown): Promise<string | LogError> {
  if (!isHash(hash)) return 'denied'
  const res = await execGit(root, ['rev-parse', '--verify', '-q', `${hash}^{commit}`], { maxBytes: 4096 })
  return res.code === 0 ? res.stdout.trim() : 'missing'
}

export async function logPage(root: string, rawQuery: unknown): Promise<LogPageResult> {
  const q = cleanLogQuery(rawQuery, root)
  const hasHead = (await execGit(root, ['rev-parse', '-q', '--verify', 'HEAD'], { maxBytes: 4096 })).code === 0
  if (!hasHead && !q.branch) return { ok: true, commits: [], more: false }
  const res = await execGit(root, logArgs(q), T)
  if (res.code !== 0 && !res.truncated) return { ok: false, error: fail(res) }
  let commits = parseLog(res.stdout)
  const more = commits.length > LOG_PAGE || res.truncated
  commits = commits.slice(0, LOG_PAGE)
  // A hash typed in the text field: that commit first, then the message matches.
  if (q.skip === 0 && q.text && isHash(q.text)) {
    const full = await resolveCommit(root, q.text)
    if (full !== 'denied' && full !== 'missing') {
      const one = await execGit(root, ['log', '-z', `--format=${LOG_FORMAT}`, '-n', '1', full, '--'], T)
      const found = one.code === 0 ? parseLog(one.stdout)[0] : undefined
      if (found) commits = [found, ...commits.filter((c) => c.hash !== found.hash)]
    }
  }
  return { ok: true, commits, more }
}

/** First parent, or the empty tree for a root commit. */
async function parentOf(root: string, parents: string[]): Promise<string | null> {
  return parents[0] ?? (await emptyTree(root))
}

export async function commitDetail(root: string, hash: unknown): Promise<CommitDetail> {
  const full = await resolveCommit(root, hash)
  if (full === 'denied' || full === 'missing') return { ok: false, error: full }
  const show = await execGit(root, ['show', '-s', `--format=${['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f')}`, full], T)
  if (show.code !== 0) return { ok: false, error: fail(show) }
  const f = show.stdout.split(FS)
  const parents = f[1] ? f[1].split(' ') : []
  const base = await parentOf(root, parents)
  if (!base) return { ok: false, error: 'failed' }
  const [names, nums] = await Promise.all([
    execGit(root, ['diff-tree', '-r', '-z', '-M', '--name-status', base, full], T),
    execGit(root, ['diff-tree', '-r', '-z', '-M', '--numstat', base, full], T),
  ])
  if (names.code !== 0) return { ok: false, error: fail(names) }
  const counts = nums.code === 0 ? parseNumstat(nums.stdout) : new Map()
  const all = parseNameStatus(names.stdout)
  const files = all.slice(0, MAX_COMMIT_FILES).map((file) => ({ ...file, ...(counts.get(file.path) ?? {}) }))
  return {
    ok: true,
    hash: f[0]!,
    parents,
    author: f[2]!,
    email: f[3]!,
    authorTime: Number(f[4]) || 0,
    committer: f[5]!,
    committerEmail: f[6]!,
    commitTime: Number(f[7]) || 0,
    message: f.slice(8).join(FS).replace(/\n+$/, ''),
    files,
    truncated: all.length > MAX_COMMIT_FILES || names.truncated,
  }
}

export async function branchesContaining(root: string, hash: unknown): Promise<ContainsResult> {
  const full = await resolveCommit(root, hash)
  if (full === 'denied' || full === 'missing') return { ok: false, error: full }
  const res = await execGit(root, ['branch', '-a', '--contains', full, '--format=%(refname:short)'], T)
  if (res.code !== 0) return { ok: false, error: fail(res) }
  return { ok: true, branches: res.stdout.split('\n').filter((b) => b && !b.endsWith('/HEAD')).slice(0, 500) }
}

export async function commitDiff(root: string, hash: unknown, rel: unknown, optsInput?: unknown, origRel?: unknown): Promise<ChangesDiff> {
  const safe = safeRepoPath(root, rel)
  const orig = origRel === undefined ? null : safeRepoPath(root, origRel)
  if (!safe || (origRel !== undefined && !orig)) return { ok: false, error: 'denied' }
  const full = await resolveCommit(root, hash)
  if (full === 'denied' || full === 'missing') return { ok: false, error: full }
  const parents = (await execGit(root, ['rev-list', '--parents', '-n', '1', full], { maxBytes: 16_384 })).stdout.trim().split(' ').slice(1)
  const base = await parentOf(root, parents)
  if (!base) return { ok: false, error: 'failed' }
  const opts: Required<DiffOptions> = cleanDiffOptions(optsInput)
  const paths = orig ? [orig.rel, safe.rel] : [safe.rel]
  const runDiff = (o: Required<DiffOptions>, maxBytes: number) => execGit(root, ['diff', base, full, '-M', '--no-ext-diff', '--no-textconv', ...diffArgs(o), '--', ...paths], { maxBytes, timeoutMs: 20_000 })
  let res = await runDiff(opts, opts.context === 'full' ? MAX_FULL_DIFF_BYTES : MAX_DIFF_BYTES)
  let partial = false
  if (res.truncated && opts.context === 'full') {
    partial = true
    res = await runDiff({ ...opts, context: 3 }, MAX_DIFF_BYTES)
  }
  if (res.code !== 0 && !res.truncated) return { ok: false, error: 'failed' }
  if (res.truncated) return { ok: true, path: safe.rel, text: '', binary: false, tooLarge: true, untracked: false }
  const binary = /^Binary files .* differ$/m.test(res.stdout) && !/^@@ /m.test(res.stdout)
  return { ok: true, path: safe.rel, text: res.stdout, binary, tooLarge: false, untracked: false, ...(partial ? { partial } : {}) }
}
