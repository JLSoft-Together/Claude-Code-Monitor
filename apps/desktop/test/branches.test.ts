import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkBranchName } from '@ccm/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBranch, deletePlan, failed, fetchAll, runDelete, sanitizeGitError, updateBranch } from '../src/preview/branches'
import { registerPreviewIpc } from '../src/preview/ipc'
import type { PreviewServer } from '../src/preview/server'
import type { RootWatcher } from '../src/preview/watch'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-branches-')))
const origin = path.join(tmp, 'origin.git')
const repo = path.join(tmp, 'repo')
const other = path.join(tmp, 'other')
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commit = (cwd: string, file: string, text: string, msg: string) => {
  writeFileSync(path.join(cwd, file), text)
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', msg)
}

beforeAll(() => {
  execFileSync('git', ['init', '-q', '--bare', origin])
  execFileSync('git', ['--git-dir', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'ignore' })
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  commit(repo, 'a.txt', '1\n', 'one')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'branch', 'side')
  git(repo, 'push', '-q', '-u', 'origin', 'side')
  execFileSync('git', ['clone', '-q', origin, other], { stdio: 'ignore' })
}, 30_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('checkBranchName', () => {
  it('accepts normal names and rejects git-invalid ones', () => {
    expect(checkBranchName('feature/x-1')).toEqual({ ok: true })
    for (const bad of ['', 'a b', '-x', 'a..b', 'a~1', 'x.lock', 'a/', '.hidden', 'a//b', 'a:b']) expect(checkBranchName(bad).ok).toBe(false)
  })
})

describe('sanitizeGitError', () => {
  it('strips credentials from URLs and keeps one line', () => {
    expect(sanitizeGitError("fatal: unable to access 'https://bob:ghp_SECRET@github.com/o/r.git/': 403\nmore")).toBe("fatal: unable to access 'https://github.com/o/r.git/': 403")
  })
})

describe('failed', () => {
  const res = (stderr: string) => ({ code: 1, stdout: '', stderr, truncated: false })
  it('maps 403 to auth only in an HTTP error context', () => {
    expect(failed(res("fatal: unable to access 'https://x/r.git/': The requested URL returned error: 403"))).toMatchObject({ error: 'auth' })
    expect(failed(res('remote: 403 Forbidden'))).toMatchObject({ error: 'auth' })
    expect(failed(res("fatal: couldn't find remote ref refs/heads/fix-403"))).toMatchObject({ error: 'failed' })
  })
  it("maps GitHub's no-access 404 to auth", () => {
    expect(failed(res("remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found"))).toMatchObject({
      error: 'auth',
      detail: 'remote: Repository not found.',
    })
  })
  it('uses the fallback when nothing matches', () => {
    expect(failed(res('fatal: something else'))).toMatchObject({ error: 'failed' })
    expect(failed(res(' ! [rejected]        side -> side  (non-fast-forward)'))).toMatchObject({ error: 'non-ff' })
  })
})

describe('createBranch', () => {
  it('accepts a full SHA-256 hash as base', async () => {
    const r256 = path.join(tmp, 'sha256')
    execFileSync('git', ['init', '-q', '--object-format=sha256', r256])
    commit(r256, 'a.txt', '1\n', 'one')
    const hash = git(r256, 'rev-parse', 'HEAD')
    expect(hash).toHaveLength(64)
    expect(await createBranch(r256, 'from-hash', hash, false)).toEqual({ ok: true })
    expect(git(r256, 'rev-parse', 'from-hash')).toBe(hash)
  })
  it('creates from a ref, optionally switching to it', async () => {
    expect(await createBranch(repo, 'feat/a', 'refs/heads/main', false)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('main')
    expect(await createBranch(repo, 'feat/b', 'HEAD', true)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('feat/b')
    git(repo, 'checkout', '-q', 'main')
  })
  it('refuses bad names, unknown bases and existing branches', async () => {
    expect(await createBranch(repo, '-x', 'HEAD', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'ok', 'refs/heads/nope', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'ok', '--orphan', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'feat/a', 'HEAD', false)).toMatchObject({ ok: false, error: 'exists' })
  })
})

describe('delete', () => {
  it('plans exact commands, refuses the current branch and tags', async () => {
    expect(await deletePlan(repo, 'refs/heads/feat/a', false)).toEqual({ ok: true, args: ['branch', '-d', '--', 'feat/a'], remote: false, label: 'feat/a' })
    expect(await deletePlan(repo, 'refs/heads/feat/a', true)).toMatchObject({ args: ['branch', '-D', '--', 'feat/a'] })
    expect(await deletePlan(repo, 'refs/remotes/origin/side', false)).toEqual({ ok: true, args: ['push', 'origin', '--delete', 'refs/heads/side'], remote: true, label: 'origin/side' })
    expect(await deletePlan(repo, 'refs/heads/main', false)).toEqual({ ok: false, error: 'current' })
    expect(await deletePlan(repo, 'refs/tags/v1', false)).toEqual({ ok: false, error: 'denied' })
    expect(await deletePlan(repo, 'refs/heads/../x', false)).toEqual({ ok: false, error: 'denied' })
  })
  it('reports an unmerged branch so the user can force it', async () => {
    git(repo, 'checkout', '-q', 'feat/a')
    commit(repo, 'b.txt', 'b\n', 'two')
    git(repo, 'checkout', '-q', 'main')
    const soft = await deletePlan(repo, 'refs/heads/feat/a', false)
    expect(soft.ok && (await runDelete(repo, soft.args))).toMatchObject({ ok: false, error: 'not-merged' })
    const hard = await deletePlan(repo, 'refs/heads/feat/a', true)
    expect(hard.ok && (await runDelete(repo, hard.args))).toEqual({ ok: true })
  })
})

describe('fetch / update', () => {
  it('fetches and fast-forwards the current and a non-current branch', async () => {
    commit(other, 'a.txt', '2\n', 'remote main')
    git(other, 'push', '-q', 'origin', 'main')
    git(other, 'checkout', '-q', 'side')
    commit(other, 's.txt', 's\n', 'remote side')
    git(other, 'push', '-q', 'origin', 'side')
    expect(await fetchAll(repo)).toEqual({ ok: true })
    expect(await updateBranch(repo, 'refs/heads/main')).toEqual({ ok: true })
    expect(git(repo, 'rev-parse', 'main')).toBe(git(other, 'rev-parse', 'main'))
    expect(await updateBranch(repo, 'refs/heads/side')).toEqual({ ok: true })
    expect(git(repo, 'rev-parse', 'side')).toBe(git(other, 'rev-parse', 'side'))
  }, 30_000)
  it('refuses branches without upstream and non-fast-forward updates', async () => {
    expect(await updateBranch(repo, 'refs/heads/feat/b')).toEqual({ ok: false, error: 'no-upstream' })
    git(repo, 'checkout', '-q', 'side')
    commit(repo, 'local.txt', 'l\n', 'local side')
    git(repo, 'checkout', '-q', 'main')
    commit(other, 's2.txt', 's2\n', 'remote side 2')
    git(other, 'push', '-q', 'origin', 'side')
    const before = git(repo, 'rev-parse', 'side')
    expect(await updateBranch(repo, 'refs/heads/side')).toMatchObject({ ok: false, error: 'non-ff' })
    expect(git(repo, 'rev-parse', 'side')).toBe(before)
  }, 30_000)
  it('reports a plain failure (not non-ff) when the upstream branch is gone', async () => {
    git(repo, 'branch', 'gone')
    git(repo, 'push', '-q', '-u', 'origin', 'gone')
    execFileSync('git', ['--git-dir', origin, 'branch', '-D', 'gone'], { stdio: 'ignore' })
    expect(await updateBranch(repo, 'refs/heads/gone')).toMatchObject({ ok: false, error: 'failed' })
  }, 30_000)
})

describe('branch IPC', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  const asked: string[][] = []
  let answer = true
  registerPreviewIpc({
    ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never,
    isAppFrame: () => true,
    server: { tokensUnder: () => [] } as unknown as PreviewServer,
    watcher: { listen: () => undefined, add: () => true, remove: () => undefined } as unknown as RootWatcher,
    shell: {} as never,
    dialog: {} as never,
    getWindow: () => null,
    getRoots: () => [repo],
    confirmAccess: async () => false,
    confirmGit: async (req) => {
      asked.push(req.commands)
      return answer
    },
  })
  const call = (ch: string, arg: unknown) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, arg))

  beforeAll(async () => {
    // The Log registers its repo through log-refs first; branch handlers only accept known repos.
    await call('ccm:log-refs', repo)
  })

  it('asks before deleting and runs nothing when cancelled', async () => {
    git(repo, 'branch', 'tmp-del')
    answer = false
    expect(await call('ccm:git-branch-delete', { root: repo, ref: 'refs/heads/tmp-del' })).toEqual({ ok: false, error: 'cancelled' })
    expect(asked.at(-1)).toEqual(['git branch -d -- tmp-del'])
    expect(git(repo, 'branch', '--list', 'tmp-del')).toContain('tmp-del')
    answer = true
    expect(await call('ccm:git-branch-delete', { root: repo, ref: 'refs/heads/tmp-del' })).toEqual({ ok: true })
    expect(git(repo, 'branch', '--list', 'tmp-del')).toBe('')
  })

  it('asks a second time with -D for an unmerged branch', async () => {
    git(repo, 'checkout', '-q', '-b', 'tmp-unmerged')
    commit(repo, 'u.txt', 'u\n', 'unmerged')
    git(repo, 'checkout', '-q', 'main')
    answer = true
    expect(await call('ccm:git-branch-delete', { root: repo, ref: 'refs/heads/tmp-unmerged' })).toEqual({ ok: true })
    expect(asked.slice(-2)).toEqual([['git branch -d -- tmp-unmerged'], ['git branch -D -- tmp-unmerged']])
  })

  it('creates without a confirm and refuses unknown roots', async () => {
    expect(await call('ccm:git-branch-create', { root: repo, name: 'ipc-new', base: 'HEAD', checkout: false })).toEqual({ ok: true })
    expect(await call('ccm:git-branch-create', { root: tmp, name: 'x', base: 'HEAD', checkout: false })).toEqual({ ok: false, error: 'denied' })
  })
})
