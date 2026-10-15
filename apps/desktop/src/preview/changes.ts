import { promises as fs, watch as fsWatch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { execGit } from './gitExec'
import { isWithin, realOrNull, rootKey } from './paths'

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface ChangeEntry {
  /** Relative to the repo root, `/` separators. */
  path: string
  origPath?: string
  /** porcelain v2 XY: `.` = unchanged, `?` untracked. */
  x: string
  y: string
  kind: ChangeKind
  staged: boolean
  added?: number
  removed?: number
  binary?: boolean
}

export type ChangesError = 'denied' | 'no-git' | 'not-repo' | 'failed' | 'conflict' | 'stale' | 'missing'

export type ChangesStatus =
  | { ok: true; root: string; branch: string | null; entries: ChangeEntry[]; truncated: boolean }
  | { ok: false; error: ChangesError }

export type ChangesDiff =
  /** `partial`: a full-context diff went past its cap, so `text` holds the usual 3-line-context diff instead. */
  | { ok: true; path: string; text: string; binary: boolean; tooLarge: boolean; untracked: boolean; partial?: boolean }
  | { ok: false; error: ChangesError }

/** `imports`: git gets the `all-blank` flags; the page drops import-only changes from the parsed diff. */
export type DiffWhitespace = 'none' | 'eol' | 'all' | 'all-blank' | 'imports'

export interface DiffOptions {
  /** Lines of context; 'full' = the whole file in one hunk (Diff Viewer with Collapse unchanged). */
  context?: 3 | 'full'
  whitespace?: DiffWhitespace
}

/** File viewer gutter: the file's own diff vs HEAD. `kind` null = clean, ignored or outside the repo index. */
export type ChangesFile =
  | {
      ok: true
      root: string
      rel: string
      kind: ChangeKind | null
      staged: boolean
      text: string
      binary: boolean
      tooLarge: boolean
      untracked: boolean
    }
  | { ok: false; error: ChangesError }

export type ChangesResult = { ok: true } | { ok: false; error: ChangesError; detail?: string }

export const MAX_DIFF_BYTES = 1024 * 1024
/** Full-context diffs carry every unchanged line too. */
export const MAX_FULL_DIFF_BYTES = 3 * 1024 * 1024
const FULL_CONTEXT = '-U1000000'

const WHITESPACE_ARGS: Record<DiffWhitespace, string[]> = {
  none: [],
  eol: ['--ignore-space-at-eol'],
  all: ['-w'],
  'all-blank': ['-w', '--ignore-blank-lines'],
  imports: ['-w', '--ignore-blank-lines'],
}

/** Page-supplied options → known values only. */
export function cleanDiffOptions(raw: unknown): Required<DiffOptions> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const whitespace = typeof o.whitespace === 'string' && Object.hasOwn(WHITESPACE_ARGS, o.whitespace) ? (o.whitespace as DiffWhitespace) : 'none'
  return { context: o.context === 'full' ? 'full' : 3, whitespace }
}

/** `git diff` flags for the options (after `diff <base>`). Histogram, like IntelliJ: fewer `}` / blank-line mismatches than Myers. */
export function diffArgs(opts: DiffOptions = {}): string[] {
  const { context, whitespace } = cleanDiffOptions(opts)
  return ['--histogram', ...(context === 'full' ? [FULL_CONTEXT] : []), ...WHITESPACE_ARGS[whitespace]]
}
export const MAX_ENTRIES = 5000

/** Parses `git status --porcelain=v2 -z [--branch]` output. */
export function parseStatusV2(out: string): { branch: string | null; entries: ChangeEntry[] } {
  const parts = out.split('\0')
  const entries: ChangeEntry[] = []
  let branch: string | null = null
  let oid: string | null = null
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]!
    if (!rec) continue
    const type = rec[0]
    if (type === '#') {
      const head = /^# branch\.head (.+)$/.exec(rec)
      if (head) branch = head[1] === '(detached)' ? null : head[1]!
      const id = /^# branch\.oid ([0-9a-f]+)$/.exec(rec)
      if (id) oid = id[1]!
      continue
    }
    if (type === '?') {
      entries.push({ path: rec.slice(2), x: '?', y: '?', kind: 'untracked', staged: false })
      continue
    }
    if (type === '!') continue
    const fields = rec.split(' ')
    const xy = fields[1] ?? '..'
    const x = xy[0] ?? '.'
    const y = xy[1] ?? '.'
    if (type === '1') {
      const file = fields.slice(8).join(' ')
      const kind: ChangeKind = x === 'A' ? 'added' : x === 'D' || y === 'D' ? 'deleted' : 'modified'
      entries.push({ path: file, x, y, kind, staged: x !== '.' })
    } else if (type === '2') {
      const file = fields.slice(9).join(' ')
      const orig = parts[++i] ?? ''
      entries.push({ path: file, origPath: orig, x, y, kind: x === 'C' ? 'added' : 'renamed', staged: x !== '.' })
    } else if (type === 'u') {
      entries.push({ path: fields.slice(10).join(' '), x, y, kind: 'conflict', staged: false })
    }
  }
  if (!branch && oid) branch = oid.slice(0, 7)
  return { branch, entries }
}

/** `git diff --numstat -z` → per path counts; renames report under the new path. */
export function parseNumstat(out: string): Map<string, { added?: number; removed?: number; binary: boolean }> {
  const map = new Map<string, { added?: number; removed?: number; binary: boolean }>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]!
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(rec)
    if (!m) continue
    let file = m[3]!
    // rename: "a\tr\t" then orig, new as separate records
    if (!file) {
      i++
      file = parts[++i] ?? ''
    }
    const binary = m[1] === '-'
    map.set(file, binary ? { binary } : { added: Number(m[1]), removed: Number(m[2]), binary })
  }
  return map
}

/** Relative repo path from the page → absolute path inside `root`, or null. */
export function safeRepoPath(root: string, rel: unknown, platform: NodeJS.Platform = process.platform): { rel: string; abs: string } | null {
  if (typeof rel !== 'string' || !rel || rel.length > 4096 || rel.includes('\0')) return null
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.startsWith('\\\\')) return null
  const clean = rel.replace(/\\/g, '/')
  if (clean.split('/').some((p) => p === '..')) return null
  const abs = path.resolve(root, clean)
  if (abs === path.resolve(root) || !isWithin(root, abs, platform)) return null
  return { rel: clean, abs }
}

const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Keeps exactly one hunk from a page-built patch and re-heads it for `rel`, so the page can never
 * point `git apply` at another file. null when the hunk is malformed or its line counts do not add up.
 */
export function hunkPatchFor(rel: string, patch: unknown): string | null {
  if (typeof patch !== 'string' || patch.length > MAX_DIFF_BYTES) return null
  const lines = patch.split('\n')
  const start = lines.findIndex((l) => l.startsWith('@@ '))
  if (start < 0) return null
  const head = HUNK_HEAD.exec(lines[start]!)
  if (!head) return null
  const oldCount = head[2] === undefined ? 1 : Number(head[2])
  const newCount = head[4] === undefined ? 1 : Number(head[4])
  const body: string[] = []
  let olds = 0
  let news = 0
  for (const line of lines.slice(start + 1)) {
    if (line === '' && olds === oldCount && news === newCount) break
    const c = line[0]
    if (c === ' ') {
      olds++
      news++
    } else if (c === '-') olds++
    else if (c === '+') news++
    else if (c !== '\\') return null
    body.push(line)
    if (olds > oldCount || news > newCount) return null
  }
  if (olds !== oldCount || news !== newCount) return null
  return [`diff --git a/${rel} b/${rel}`, `--- a/${rel}`, `+++ b/${rel}`, lines[start]!, ...body, ''].join('\n')
}

/** Whole-file "new file" diff for an untracked text file (git's --no-index needs /dev/null quirks per OS). */
export function newFileDiff(rel: string, text: string): string {
  const body = text.split('\n')
  const endsWithNl = text.endsWith('\n')
  if (endsWithNl) body.pop()
  if (!text.length) return [`diff --git a/${rel} b/${rel}`, 'new file mode 100644', ''].join('\n')
  const out = [`diff --git a/${rel} b/${rel}`, 'new file mode 100644', '--- /dev/null', `+++ b/${rel}`, `@@ -0,0 +1,${body.length} @@`, ...body.map((l) => `+${l}`)]
  if (!endsWithNl) out.push('\\ No newline at end of file')
  return out.join('\n') + '\n'
}

export async function toplevel(dir: string): Promise<{ root: string } | { error: ChangesError }> {
  const res = await execGit(dir, ['rev-parse', '--show-toplevel'], { maxBytes: 16_384, timeoutMs: 10_000 })
  if (res.code === null && res.stderr === 'git not found') return { error: 'no-git' }
  if (res.code !== 0) return { error: 'not-repo' }
  const real = await realOrNull(path.normalize(res.stdout.trim()))
  return real ? { root: real } : { error: 'not-repo' }
}

/** Shared `.git` of a checkout: the main checkout and every worktree of one repo answer the same path. */
export async function commonDir(dir: string): Promise<string | null> {
  const opts = { maxBytes: 16_384, timeoutMs: 10_000 }
  // `--path-format` needs git 2.31; older gits print a path relative to `dir`.
  let res = await execGit(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'], opts)
  if (res.code !== 0) res = await execGit(dir, ['rev-parse', '--git-common-dir'], opts)
  const out = res.code === 0 ? res.stdout.trim() : ''
  return out ? realOrNull(path.resolve(dir, out)) : null
}

async function hasHead(root: string): Promise<boolean> {
  return (await execGit(root, ['rev-parse', '--verify', '-q', 'HEAD'], { maxBytes: 4096 })).code === 0
}

/** Empty tree id of this repo's hash algorithm (sha1 / sha256). */
export async function emptyTree(root: string): Promise<string | null> {
  const res = await execGit(root, ['hash-object', '-t', 'tree', '--stdin'], { input: '', maxBytes: 4096 })
  return res.code === 0 ? res.stdout.trim() : null
}

/** HEAD, or the empty tree in a repo without commits. */
export async function baseRev(root: string): Promise<string | null> {
  if (await hasHead(root)) return 'HEAD'
  return emptyTree(root)
}

async function countLines(abs: string): Promise<{ added?: number; binary: boolean }> {
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat?.isFile() || stat.size > MAX_DIFF_BYTES) return { binary: false }
  const buf = await fs.readFile(abs).catch(() => null)
  if (!buf) return { binary: false }
  if (buf.subarray(0, 8192).includes(0)) return { binary: true }
  const text = buf.toString('utf8')
  if (!text) return { added: 0, binary: false }
  return { added: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), binary: false }
}

/** `root` must already be a real repo toplevel (see `toplevel`). */
export async function status(root: string): Promise<ChangesStatus> {
  const res = await execGit(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], { timeoutMs: 20_000 })
  if (res.code === null && res.stderr === 'git not found') return { ok: false, error: 'no-git' }
  if (res.code !== 0) return { ok: false, error: 'failed' }
  const parsed = parseStatusV2(res.stdout)
  const truncated = parsed.entries.length > MAX_ENTRIES || res.truncated
  const entries = parsed.entries.slice(0, MAX_ENTRIES)
  const base = await baseRev(root)
  if (base) {
    const num = await execGit(root, ['diff', base, '--histogram', '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv'], { timeoutMs: 20_000 })
    if (num.code === 0) {
      const counts = parseNumstat(num.stdout)
      for (const e of entries) Object.assign(e, counts.get(e.path) ?? {})
    }
  }
  const untracked = entries.filter((e) => e.kind === 'untracked').slice(0, 300)
  await Promise.all(untracked.map(async (e) => Object.assign(e, await countLines(path.join(root, e.path)))))
  return { ok: true, root, branch: parsed.branch, entries, truncated }
}

async function entryFor(root: string, rel: string): Promise<ChangeEntry | null> {
  const res = await execGit(root, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', rel], { timeoutMs: 15_000 })
  if (res.code !== 0) return null
  return parseStatusV2(res.stdout).entries.find((e) => e.path === rel) ?? null
}

export async function diff(root: string, relInput: unknown, optsInput?: unknown): Promise<ChangesDiff> {
  const safe = safeRepoPath(root, relInput)
  if (!safe) return { ok: false, error: 'denied' }
  const entry = await entryFor(root, safe.rel)
  return diffEntry(root, safe, entry, cleanDiffOptions(optsInput))
}

async function diffEntry(root: string, safe: { rel: string; abs: string }, entry: ChangeEntry | null, opts: Required<DiffOptions>): Promise<ChangesDiff> {
  if (!entry) return { ok: true, path: safe.rel, text: '', binary: false, tooLarge: false, untracked: false }
  if (entry.kind === 'untracked') {
    const stat = await fs.stat(safe.abs).catch(() => null)
    if (!stat?.isFile()) return { ok: false, error: 'missing' }
    if (stat.size > MAX_DIFF_BYTES) return { ok: true, path: safe.rel, text: '', binary: false, tooLarge: true, untracked: true }
    const buf = await fs.readFile(safe.abs).catch(() => null)
    if (!buf) return { ok: false, error: 'missing' }
    if (buf.subarray(0, 8192).includes(0)) return { ok: true, path: safe.rel, text: '', binary: true, tooLarge: false, untracked: true }
    return { ok: true, path: safe.rel, text: newFileDiff(safe.rel, buf.toString('utf8')), binary: false, tooLarge: false, untracked: true }
  }
  const base = await baseRev(root)
  if (!base) return { ok: false, error: 'failed' }
  const paths = entry.origPath ? [entry.origPath, entry.path] : [entry.path]
  const run = (o: Required<DiffOptions>, maxBytes: number) =>
    execGit(root, ['diff', base, '-M', '--no-ext-diff', '--no-textconv', ...diffArgs(o), '--', ...paths], { maxBytes, timeoutMs: 20_000 })
  let res = await run(opts, opts.context === 'full' ? MAX_FULL_DIFF_BYTES : MAX_DIFF_BYTES)
  let partial = false
  if (res.truncated && opts.context === 'full') {
    partial = true
    res = await run({ ...opts, context: 3 }, MAX_DIFF_BYTES)
  }
  if (res.code !== 0 && !res.truncated) return { ok: false, error: 'failed' }
  if (res.truncated) return { ok: true, path: safe.rel, text: '', binary: false, tooLarge: true, untracked: false }
  const binary = /^Binary files .* differ$/m.test(res.stdout) && !/^@@ /m.test(res.stdout)
  return { ok: true, path: safe.rel, text: res.stdout, binary, tooLarge: false, untracked: false, ...(partial ? { partial } : {}) }
}

/**
 * Diff vs HEAD of one file the page shows (`abs` already real and allowed); `repoRoot` resolves its
 * git toplevel (the IPC layer registers it so later discards against that root are accepted).
 */
export async function fileDiff(abs: string, repoRoot: (dir: string) => Promise<{ root: string } | { error: ChangesError }>): Promise<ChangesFile> {
  const top = await repoRoot(path.dirname(abs))
  if ('error' in top) return { ok: false, error: top.error }
  const root = top.root
  const rel = path.relative(root, abs)
  const safe = safeRepoPath(root, rel)
  if (!safe) return { ok: false, error: 'denied' }
  const entry = await entryFor(root, safe.rel)
  const none = { ok: true as const, root, rel: safe.rel, kind: null, staged: false, text: '', binary: false, tooLarge: false, untracked: false }
  if (!entry || entry.kind === 'deleted' || entry.kind === 'conflict') return entry ? { ...none, kind: entry.kind, staged: entry.staged } : none
  const res = await diffEntry(root, safe, entry, { context: 3, whitespace: 'none' })
  if (!res.ok) return res
  return { ok: true, root, rel: safe.rel, kind: entry.kind, staged: entry.staged, text: res.text, binary: res.binary, tooLarge: res.tooLarge, untracked: res.untracked }
}

export interface DiscardDeps {
  /** OS trash (Electron `shell.trashItem`); untracked and newly added files go there, never `rm`. */
  trash: (abs: string) => Promise<void>
}

const failed = (detail: string): ChangesResult => ({ ok: false, error: 'failed', detail: detail.trim().slice(0, 400) })

export async function discardFile(root: string, relInput: unknown, deps: DiscardDeps): Promise<ChangesResult> {
  const safe = safeRepoPath(root, relInput)
  if (!safe) return { ok: false, error: 'denied' }
  const entry = await entryFor(root, safe.rel)
  if (!entry) return { ok: false, error: 'stale' }
  if (entry.kind === 'conflict') return { ok: false, error: 'conflict' }
  const trashIfThere = async (abs: string): Promise<ChangesResult> => {
    if (!(await fs.lstat(abs).catch(() => null))) return { ok: true }
    try {
      await deps.trash(abs)
      return { ok: true }
    } catch (err) {
      return failed(String(err))
    }
  }
  if (entry.kind === 'untracked') return trashIfThere(safe.abs)
  if (entry.kind === 'added' || entry.kind === 'renamed') {
    const unstage = await execGit(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', entry.path])
    if (unstage.code !== 0) return failed(unstage.stderr)
    const trashed = await trashIfThere(safe.abs)
    if (!trashed.ok || !entry.origPath) return trashed
    const orig = safeRepoPath(root, entry.origPath)
    if (!orig) return { ok: false, error: 'denied' }
    const res = await execGit(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', orig.rel])
    return res.code === 0 ? { ok: true } : failed(res.stderr)
  }
  const res = await execGit(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', entry.path])
  return res.code === 0 ? { ok: true } : failed(res.stderr)
}

/** Reverse-applies one hunk to the working tree; `--check` first so a stale hunk changes nothing. */
export async function discardHunk(root: string, relInput: unknown, patch: unknown): Promise<ChangesResult> {
  const safe = safeRepoPath(root, relInput)
  if (!safe) return { ok: false, error: 'denied' }
  const entry = await entryFor(root, safe.rel)
  if (!entry) return { ok: false, error: 'stale' }
  if (entry.kind === 'conflict') return { ok: false, error: 'conflict' }
  if (entry.kind !== 'modified') return { ok: false, error: 'denied' }
  const text = hunkPatchFor(safe.rel, patch)
  if (!text) return { ok: false, error: 'denied' }
  const args = ['apply', '-R', '--whitespace=nowarn']
  const check = await execGit(root, [...args, '--check', '-'], { input: text })
  if (check.code !== 0) return { ok: false, error: 'stale', detail: check.stderr.trim().slice(0, 400) }
  const res = await execGit(root, [...args, '-'], { input: text })
  return res.code === 0 ? { ok: true } : failed(res.stderr)
}

/**
 * Watches the git dir (index / HEAD) of a repo: commits, staging and checkouts never touch the
 * working tree the RootWatcher sees (it ignores .git).
 */
const GIT_DIR_FILES = new Set(['index', 'HEAD', 'MERGE_HEAD', 'packed-refs', 'FETCH_HEAD', 'ORIG_HEAD'])

export class GitDirWatcher {
  private entries = new Map<string, { refs: number; watchers: FSWatcher[]; timer: NodeJS.Timeout | null }>()

  constructor(private readonly onChange: (root: string) => void) {}

  async add(root: string): Promise<void> {
    const key = rootKey(root)
    const known = this.entries.get(key)
    if (known) {
      known.refs++
      return
    }
    const entry = { refs: 1, watchers: [] as FSWatcher[], timer: null as NodeJS.Timeout | null }
    this.entries.set(key, entry)
    const res = await execGit(root, ['rev-parse', '--absolute-git-dir'], { maxBytes: 16_384 })
    if (res.code !== 0 || this.entries.get(key) !== entry) return
    const gitDir = path.normalize(res.stdout.trim())
    const fire = (): void => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = null
        if (this.entries.get(key) === entry) this.onChange(root)
      }, 200)
    }
    const watchOne = (dir: string, opts: { recursive: boolean }, accept: (name: string) => boolean): void => {
      try {
        const w = fsWatch(dir, opts, (_event, file) => accept(file ? String(file) : '') && fire())
        w.on('error', () => this.drop(key))
        entry.watchers.push(w)
      } catch {
        // not watchable (e.g. recursive unsupported); the other watcher and working tree events still arrive
      }
    }
    watchOne(gitDir, { recursive: false }, (name) => GIT_DIR_FILES.has(name))
    // Commits, fetches and new branches only touch refs/ (Log pane).
    watchOne(path.join(gitDir, 'refs'), { recursive: true }, (name) => !name.endsWith('.lock'))
  }

  remove(root: string): void {
    const key = rootKey(root)
    const entry = this.entries.get(key)
    if (entry && --entry.refs <= 0) this.drop(key)
  }

  closeAll(): void {
    for (const key of [...this.entries.keys()]) this.drop(key)
  }

  private drop(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    if (entry.timer) clearTimeout(entry.timer)
    for (const w of entry.watchers) {
      try {
        w.close()
      } catch {
        // already closed
      }
    }
  }
}
