import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { safeRepoPath } from './changes'
import { execGit } from './gitExec'
import { rootKey } from './paths'

export interface Checkpoint {
  id: string
  at: number
  label: string
}

export interface CheckpointFile {
  path: string
  /** A = only now (added since), D = only in the checkpoint (deleted since), M = changed. */
  status: 'A' | 'D' | 'M'
  added?: number
  removed?: number
}

export type CheckpointError = 'denied' | 'off' | 'busy' | 'unknown' | 'failed'
export type TakeResult = { ok: true; id: string | null } | { ok: false; error: CheckpointError; detail?: string }
export type DiffResult = { ok: true; files: CheckpointFile[] } | { ok: false; error: CheckpointError; detail?: string }

const KEEP = 30
const ID = /^[0-9a-f]{40,64}$/
const IDENT = { GIT_AUTHOR_NAME: 'Orrery', GIT_AUTHOR_EMAIL: 'orrery@localhost', GIT_COMMITTER_NAME: 'Orrery', GIT_COMMITTER_EMAIL: 'orrery@localhost' }
const detail = (s: string): string => s.trim().slice(0, 300)

/**
 * Snapshots of a repo's working tree (tracked + untracked, `.gitignore` honoured) kept in a git store of the
 * app's own (`<dataDir>/checkpoints/<hash>.git`), never in the repo: its index, refs and objects stay untouched.
 * Per-repo opt-in (`enabled.json`); at most one git job per repo at a time, a turn that comes while busy is skipped.
 */
export class CheckpointStore {
  private readonly busy = new Set<string>()
  private enabled: Set<string> | null = null

  constructor(private readonly dataDir: string) {}

  private dir(root: string): string {
    return path.join(this.dataDir, 'checkpoints', `${createHash('sha1').update(rootKey(root)).digest('hex').slice(0, 16)}.git`)
  }

  private env(root: string): Record<string, string> {
    const dir = this.dir(root)
    return { GIT_DIR: dir, GIT_WORK_TREE: root, GIT_INDEX_FILE: path.join(dir, 'orrery-index'), ...IDENT }
  }

  private async load(): Promise<Set<string>> {
    if (this.enabled) return this.enabled
    const text = await fs.readFile(path.join(this.dataDir, 'checkpoints', 'enabled.json'), 'utf8').catch(() => '[]')
    let list: unknown = []
    try {
      list = JSON.parse(text)
    } catch {
      list = []
    }
    this.enabled = new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
    return this.enabled
  }

  async isOn(root: string): Promise<boolean> {
    return (await this.load()).has(rootKey(root))
  }

  async setOn(root: string, on: boolean): Promise<void> {
    const set = await this.load()
    if (on) set.add(rootKey(root))
    else set.delete(rootKey(root))
    await fs.mkdir(path.join(this.dataDir, 'checkpoints'), { recursive: true })
    await fs.writeFile(path.join(this.dataDir, 'checkpoints', 'enabled.json'), JSON.stringify([...set]))
    if (!on) await fs.rm(this.dir(root), { recursive: true, force: true }).catch(() => undefined)
  }

  private async ensure(root: string): Promise<boolean> {
    const dir = this.dir(root)
    if ((await fs.stat(path.join(dir, 'HEAD')).catch(() => null))?.isFile()) return true
    await fs.mkdir(dir, { recursive: true })
    const init = await execGit(this.dataDir, ['init', '-q', '--bare', dir], { timeoutMs: 20_000 })
    if (init.code !== 0) return false
    for (const [k, v] of [['core.bare', 'false'], ['core.autocrlf', 'false'], ['core.safecrlf', 'false'], ['gc.auto', '0']]) {
      await execGit(this.dataDir, ['--git-dir', dir, 'config', k!, v!], { timeoutMs: 10_000 })
    }
    return true
  }

  private git(root: string, args: string[], timeoutMs = 60_000) {
    return execGit(root, args, { env: this.env(root), timeoutMs, maxBytes: 16 * 1024 * 1024 })
  }

  private async tree(root: string): Promise<string | null> {
    const add = await this.git(root, ['add', '-A', '--', '.'], 120_000)
    if (add.code !== 0) return null
    const tree = await this.git(root, ['write-tree'])
    return tree.code === 0 ? tree.stdout.trim() : null
  }

  async list(root: string): Promise<Checkpoint[]> {
    if (!(await this.isOn(root))) return []
    const res = await this.git(root, ['for-each-ref', '--sort=-creatordate', `--count=${KEEP}`, '--format=%(objectname)%00%(creatordate:unix)%00%(subject)', 'refs/cp/'], 15_000)
    if (res.code !== 0) return []
    return res.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\0'))
      .map(([id = '', at = '0', label = '']) => ({ id, at: Number(at) * 1000, label }))
  }

  /** Records the current working tree unless it equals the newest checkpoint; `id` null = nothing new. */
  async take(root: string, label: string): Promise<TakeResult> {
    if (!(await this.isOn(root))) return { ok: false, error: 'off' }
    const key = rootKey(root)
    if (this.busy.has(key)) return { ok: false, error: 'busy' }
    this.busy.add(key)
    try {
      if (!(await this.ensure(root))) return { ok: false, error: 'failed' }
      const tree = await this.tree(root)
      if (!tree) return { ok: false, error: 'failed' }
      const last = (await this.list(root))[0]
      if (last) {
        const lastTree = await this.git(root, ['rev-parse', `${last.id}^{tree}`])
        if (lastTree.stdout.trim() === tree) return { ok: true, id: null }
      }
      const commit = await this.git(root, ['commit-tree', tree, '-m', label.replace(/[\r\n\0]/g, ' ').slice(0, 200) || 'turn'])
      const id = commit.stdout.trim()
      if (commit.code !== 0 || !ID.test(id)) return { ok: false, error: 'failed', detail: detail(commit.stderr) }
      await this.git(root, ['update-ref', `refs/cp/${Date.now()}`, id])
      await this.prune(root)
      return { ok: true, id }
    } finally {
      this.busy.delete(key)
    }
  }

  private async prune(root: string): Promise<void> {
    const res = await this.git(root, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)', 'refs/cp/'], 15_000)
    const old = res.stdout.split('\n').filter(Boolean).slice(KEEP)
    if (!old.length) return
    for (const ref of old) await this.git(root, ['update-ref', '-d', ref], 10_000)
    await this.git(root, ['gc', '-q', '--prune=now'], 120_000)
  }

  private async known(root: string, id: unknown): Promise<string | null> {
    if (typeof id !== 'string' || !ID.test(id)) return null
    return (await this.list(root)).some((c) => c.id === id) ? id : null
  }

  /** What changed between the checkpoint and the working tree now. */
  async diff(root: string, idInput: unknown): Promise<DiffResult> {
    const key = rootKey(root)
    const id = await this.known(root, idInput)
    if (!id) return { ok: false, error: 'unknown' }
    if (this.busy.has(key)) return { ok: false, error: 'busy' }
    this.busy.add(key)
    try {
      const now = await this.tree(root)
      if (!now) return { ok: false, error: 'failed' }
      const names = await this.git(root, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', id, now])
      const nums = await this.git(root, ['diff-tree', '-r', '-z', '--no-renames', '--numstat', id, now])
      if (names.code !== 0) return { ok: false, error: 'failed', detail: detail(names.stderr) }
      const counts = new Map<string, { added?: number; removed?: number }>()
      const np = nums.stdout.split('\0')
      for (const rec of np) {
        const m = /^(-|\d+)\t(-|\d+)\t(.+)$/s.exec(rec)
        if (m) counts.set(m[3]!, m[1] === '-' ? {} : { added: Number(m[1]), removed: Number(m[2]) })
      }
      const parts = names.stdout.split('\0').filter(Boolean)
      const files: CheckpointFile[] = []
      for (let i = 0; i + 1 < parts.length && files.length < 1000; i += 2) {
        const s = parts[i]![0]
        const status = s === 'A' ? 'A' : s === 'D' ? 'D' : 'M'
        files.push({ path: parts[i + 1]!, status, ...counts.get(parts[i + 1]!) })
      }
      return { ok: true, files }
    } finally {
      this.busy.delete(key)
    }
  }

  /**
   * Puts files back as they were in the checkpoint. A file that did not exist then is moved to the OS trash.
   * Only the working tree changes (the store's own index too); the repo's index is never written.
   */
  async restore(root: string, idInput: unknown, pathsInput: unknown, trash: (abs: string) => Promise<void>): Promise<{ ok: true } | { ok: false; error: CheckpointError; detail?: string }> {
    const id = await this.known(root, idInput)
    const list = Array.isArray(pathsInput) ? pathsInput.slice(0, 500) : []
    const safe = list.map((p) => safeRepoPath(root, p))
    if (!id || !safe.length || safe.some((s) => !s)) return { ok: false, error: 'denied' }
    const key = rootKey(root)
    if (this.busy.has(key)) return { ok: false, error: 'busy' }
    this.busy.add(key)
    try {
      const present: string[] = []
      for (const s of safe) {
        const inCp = await this.git(root, ['cat-file', '-e', `${id}:${s!.rel}`], 10_000)
        if (inCp.code === 0) present.push(s!.rel)
        else if (await fs.lstat(s!.abs).catch(() => null)) await trash(s!.abs)
      }
      if (present.length) {
        const res = await this.git(root, ['checkout', id, '--', ...present], 60_000)
        if (res.code !== 0) return { ok: false, error: 'failed', detail: detail(res.stderr) }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: 'failed', detail: detail(String(err)) }
    } finally {
      this.busy.delete(key)
    }
  }
}
