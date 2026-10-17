import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pushArgs } from '@ccm/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pushBranch, pushPreview, pushRejection } from '../src/preview/branches'
import { registerPreviewIpc } from '../src/preview/ipc'
import type { PreviewServer } from '../src/preview/server'
import type { RootWatcher } from '../src/preview/watch'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-push-')))
const origin = path.join(tmp, 'origin.git')
const repo = path.join(tmp, 'repo')
const other = path.join(tmp, 'other')
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commit = (cwd: string, file: string, text: string, msg: string) => {
  writeFileSync(path.join(cwd, file), text)
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', msg)
}
const remoteHash = (ref: string) => execFileSync('git', ['--git-dir', origin, 'rev-parse', ref], { encoding: 'utf8' }).trim()

beforeAll(() => {
  execFileSync('git', ['init', '-q', '--bare', origin])
  execFileSync('git', ['--git-dir', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'ignore' })
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  commit(repo, 'a.txt', '1\n', 'one')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  execFileSync('git', ['clone', '-q', origin, other], { stdio: 'ignore' })
}, 30_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('pushArgs / pushRejection', () => {
  it('builds one refspec, never forced', () => {
    expect(pushArgs('main', 'origin', 'main', false)).toEqual(['push', '--porcelain', 'origin', 'refs/heads/main:refs/heads/main'])
    expect(pushArgs('a', 'up', 'b', true)).toEqual(['push', '--porcelain', '--set-upstream', 'up', 'refs/heads/a:refs/heads/b'])
    expect(pushArgs('a', 'up', 'b', true).some((a) => /force|delete|mirror|--all|--tags/.test(a))).toBe(false)
  })
  it('tells a non-fast-forward from a remote refusal', () => {
    expect(pushRejection('To x\n!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\nDone')).toMatchObject({ error: 'non-ff' })
    expect(pushRejection('!\trefs/heads/main:refs/heads/main\t[remote rejected] (pre-receive hook declined)')).toEqual({ ok: false, error: 'remote-rejected', detail: 'pre-receive hook declined' })
    expect(pushRejection('=\trefs/heads/main:refs/heads/main\t[up to date]')).toBeNull()
  })
})

describe('pushPreview', () => {
  it('defaults to the upstream and lists outgoing commits', async () => {
    commit(repo, 'a.txt', '2\n', 'two')
    commit(repo, 'a.txt', '3\n', 'three')
    const p = await pushPreview(repo, 'refs/heads/main')
    expect(p).toMatchObject({ ok: true, local: 'main', remotes: ['origin'], remote: 'origin', branch: 'main', upstream: true, hasUpstream: true, exists: true, more: false })
    expect(p.ok && p.commits.map((c) => c.subject)).toEqual(['three', 'two'])
  })
  it('targets a new remote branch with the local name', async () => {
    git(repo, 'branch', 'feat/x')
    const p = await pushPreview(repo, 'refs/heads/feat/x')
    expect(p).toMatchObject({ ok: true, remote: 'origin', branch: 'feat/x', upstream: false, hasUpstream: false, exists: false })
    // Only commits no branch of origin has yet.
    expect(p.ok && p.commits.map((c) => c.subject)).toEqual(['three', 'two'])
  })
  it('refuses unknown refs, remotes and bad branch names', async () => {
    expect(await pushPreview(repo, 'refs/heads/nope')).toEqual({ ok: false, error: 'denied' })
    expect(await pushPreview(repo, 'refs/remotes/origin/main')).toEqual({ ok: false, error: 'denied' })
    expect(await pushPreview(repo, 'refs/heads/main', 'elsewhere')).toEqual({ ok: false, error: 'invalid' })
    expect(await pushPreview(repo, 'refs/heads/main', '--mirror')).toEqual({ ok: false, error: 'invalid' })
    expect(await pushPreview(repo, 'refs/heads/main', 'origin', '-f')).toEqual({ ok: false, error: 'invalid' })
    expect(await pushPreview(repo, 'refs/heads/main', 'origin', 'a..b')).toEqual({ ok: false, error: 'invalid' })
  })
  it('reports a repo without remotes', async () => {
    const lone = path.join(tmp, 'lone')
    execFileSync('git', ['init', '-q', lone])
    commit(lone, 'x.txt', 'x\n', 'x')
    const head = git(lone, 'symbolic-ref', '--short', 'HEAD')
    expect(await pushPreview(lone, `refs/heads/${head}`)).toEqual({ ok: false, error: 'no-remote' })
  })
})

describe('pushBranch', () => {
  it('pushes the branch and can set its upstream', async () => {
    expect(await pushBranch(repo, 'refs/heads/main', 'origin', 'main', false)).toEqual({ ok: true })
    expect(remoteHash('refs/heads/main')).toBe(git(repo, 'rev-parse', 'main'))
    expect(await pushBranch(repo, 'refs/heads/feat/x', 'origin', 'feat/x', true)).toEqual({ ok: true })
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'feat/x@{upstream}')).toBe('origin/feat/x')
    expect(await pushPreview(repo, 'refs/heads/feat/x')).toMatchObject({ ok: true, upstream: true, exists: true, commits: [] })
  }, 30_000)
  it('reports non-ff and leaves the remote alone', async () => {
    git(other, 'pull', '-q', '--ff-only')
    commit(other, 'b.txt', 'b\n', 'remote only')
    git(other, 'push', '-q', 'origin', 'main')
    commit(repo, 'c.txt', 'c\n', 'local only')
    const before = remoteHash('refs/heads/main')
    expect(await pushBranch(repo, 'refs/heads/main', 'origin', 'main', false)).toMatchObject({ ok: false, error: 'non-ff' })
    expect(remoteHash('refs/heads/main')).toBe(before)
  }, 30_000)
  it('reports a remote refusal (pre-receive hook)', async () => {
    const hooks = path.join(origin, 'hooks')
    mkdirSync(hooks, { recursive: true })
    writeFileSync(path.join(hooks, 'pre-receive'), '#!/bin/sh\necho "protected" >&2\nexit 1\n', { mode: 0o755 })
    git(repo, 'branch', 'guarded')
    const res = await pushBranch(repo, 'refs/heads/guarded', 'origin', 'guarded', false)
    rmSync(path.join(hooks, 'pre-receive'))
    expect(res).toMatchObject({ ok: false, error: 'remote-rejected' })
  }, 30_000)
  it('validates every part before running git', async () => {
    expect(await pushBranch(repo, 'refs/heads/main', 'nowhere', 'main', false)).toEqual({ ok: false, error: 'invalid' })
    expect(await pushBranch(repo, 'refs/heads/main', 'origin', '--force', false)).toEqual({ ok: false, error: 'invalid' })
    expect(await pushBranch(repo, 'HEAD', 'origin', 'main', false)).toEqual({ ok: false, error: 'denied' })
  })
})

describe('push IPC', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
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
  })
  const call = (ch: string, arg: unknown) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, arg))

  it('previews in a known repo and refuses unknown roots', async () => {
    await call('ccm:log-refs', repo)
    expect(await call('ccm:git-push-preview', { root: repo, ref: 'refs/heads/main' })).toMatchObject({ ok: true, local: 'main' })
    expect(await call('ccm:git-push-preview', { root: tmp, ref: 'refs/heads/main' })).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:git-push', { root: tmp, ref: 'refs/heads/main', remote: 'origin', branch: 'main', setUpstream: false })).toEqual({ ok: false, error: 'denied' })
  })
})
