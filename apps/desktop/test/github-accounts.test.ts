import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { githubRepoOf } from '@ccm/shared'
import { afterAll, describe, expect, it } from 'vitest'
import { GitHubAccounts, gitAuthEnv, type FetchFn, type TokenCrypt } from '../src/github/accounts'

const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-gh-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const crypt: TokenCrypt = {
  available: () => true,
  encrypt: (s) => Buffer.from(`sealed:${s}`),
  decrypt: (b) => b.toString().replace(/^sealed:/, ''),
}

const TOK_A = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOK_B = 'github_pat_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

/** Fake GitHub API: users by token, repo permissions by token + `owner/repo`. */
function fakeApi(repos: Record<string, Record<string, 'push' | 'read'>> = {}) {
  const users: Record<string, { login: string; name: string | null; scopes: string | null }> = {
    [TOK_A]: { login: 'alice', name: 'Alice', scopes: 'repo, read:org' },
    [TOK_B]: { login: 'bob', name: null, scopes: null },
  }
  const calls: string[] = []
  const fetch: FetchFn = async (url, init) => {
    const token = init.headers.Authorization!.replace(/^Bearer /, '')
    const route = url.replace('https://api.github.com', '')
    calls.push(`${users[token]?.login ?? '?'} ${route}`)
    const user = users[token]
    const headers = { get: (n: string) => (n === 'x-oauth-scopes' ? (user?.scopes ?? null) : null) }
    if (!user) return { status: 401, headers, json: async () => ({}) }
    if (route === '/user') return { status: 200, headers, json: async () => ({ login: user.login, name: user.name }) }
    const m = /^\/repos\/([^/]+)\/([^/]+)$/.exec(route)
    const perm = m ? repos[`${m[1]}/${m[2]}`]?.[user.login] : undefined
    if (!perm) return { status: 404, headers, json: async () => ({}) }
    return { status: 200, headers, json: async () => ({ permissions: { push: perm === 'push', pull: true } }) }
  }
  return { fetch, calls }
}

describe('githubRepoOf', () => {
  it('reads https and ssh github.com remotes', () => {
    expect(githubRepoOf('https://github.com/Titan-Team-Z/mobile-zt015-pdf.git')).toEqual({ owner: 'Titan-Team-Z', repo: 'mobile-zt015-pdf', https: true })
    expect(githubRepoOf('https://bob@github.com/o/r')).toEqual({ owner: 'o', repo: 'r', https: true })
    expect(githubRepoOf('https://github.com/o/r.js.git/')).toEqual({ owner: 'o', repo: 'r.js', https: true })
    expect(githubRepoOf('git@github.com:o/r.git')).toEqual({ owner: 'o', repo: 'r', https: false })
    expect(githubRepoOf('ssh://git@ssh.github.com:443/o/r.git')).toEqual({ owner: 'o', repo: 'r', https: false })
  })
  it('ignores other hosts and look-alikes', () => {
    expect(githubRepoOf('https://gitlab.com/o/r.git')).toBeNull()
    expect(githubRepoOf('https://github.com.evil.io/o/r.git')).toBeNull()
    expect(githubRepoOf('https://github.com/o')).toBeNull()
  })
})

describe('gitAuthEnv', () => {
  it('appends after existing GIT_CONFIG_COUNT entries', () => {
    const env = gitAuthEnv('tok', { GIT_CONFIG_COUNT: '1' })
    expect(env.GIT_CONFIG_COUNT).toBe('3')
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.https://github.com.helper')
    expect(env.GIT_CONFIG_VALUE_1).toBe('')
    expect(env.GIT_CONFIG_VALUE_2).toBe(`Authorization: Basic ${Buffer.from('x-access-token:tok').toString('base64')}`)
  })
  it('git sees the header and an emptied helper list for github.com only', () => {
    const env = { ...process.env, ...gitAuthEnv('tok', {}) }
    delete env.GIT_CONFIG_PARAMETERS
    const urlmatch = (key: string, url: string): string => {
      try {
        return execFileSync('git', ['config', '--get-urlmatch', key, url], { env, encoding: 'utf8' }).trim()
      } catch {
        return '<unset>'
      }
    }
    expect(urlmatch('http.extraHeader', 'https://github.com/o/r.git')).toMatch(/^Authorization: Basic /)
    expect(urlmatch('http.extraHeader', 'https://gitlab.com/o/r.git')).toBe('<unset>')
    expect(urlmatch('credential.helper', 'https://github.com')).toBe('')
  })
})

describe('GitHubAccounts', () => {
  it('adds by token, keeps it sealed on disk and never lists it', async () => {
    const file = path.join(dir, 'a.json')
    const store = new GitHubAccounts({ file, crypt, fetch: fakeApi().fetch })
    const res = await store.add(` ${TOK_A}\n`)
    expect(res).toMatchObject({ ok: true, account: { login: 'alice', name: 'Alice', scopes: ['repo', 'read:org'], isDefault: true } })
    expect(JSON.stringify(store.list())).not.toContain(TOK_A)
    const disk = readFileSync(file, 'utf8')
    expect(disk).not.toContain(TOK_A)
    expect(disk).toContain(Buffer.from(`sealed:${TOK_A}`).toString('base64'))
    // Reload from disk.
    expect(new GitHubAccounts({ file, crypt, fetch: fakeApi().fetch }).list()).toMatchObject([{ login: 'alice', isDefault: true }])
  })

  it('refuses bad tokens, a missing keychain and an offline check', async () => {
    const store = new GitHubAccounts({ crypt, fetch: fakeApi().fetch })
    expect(await store.add('not a token')).toEqual({ ok: false, error: 'invalid' })
    expect(await store.add('ghp_unknownunknownunknownunknown')).toEqual({ ok: false, error: 'invalid' })
    expect(await new GitHubAccounts({ crypt: { ...crypt, available: () => false }, fetch: fakeApi().fetch }).add(TOK_A)).toEqual({ ok: false, error: 'no-keychain' })
    const offline = new GitHubAccounts({ crypt, fetch: async () => Promise.reject(new Error('offline')) })
    expect(await offline.add(TOK_A)).toEqual({ ok: false, error: 'network' })
  })

  it('same login replaces the token; fine-grained has null scopes', async () => {
    const store = new GitHubAccounts({ crypt, fetch: fakeApi().fetch })
    await store.add(TOK_A)
    await store.add(TOK_A)
    await store.add(TOK_B)
    expect(store.list().map((a) => [a.login, a.scopes, a.isDefault])).toEqual([
      ['alice', ['repo', 'read:org'], true],
      ['bob', null, false],
    ])
  })

  it('auto picks the account that can push, default first; nobody → git credentials', async () => {
    const api = fakeApi({ 'team/app': { alice: 'read', bob: 'push' }, 'alice/own': { alice: 'push', bob: 'push' } })
    const store = new GitHubAccounts({ crypt, fetch: api.fetch })
    await store.add(TOK_A)
    await store.add(TOK_B)
    expect(await store.resolve('/r', 'https://github.com/team/app.git')).toMatchObject({ github: true, choice: 'auto', account: { login: 'bob' }, access: 'push' })
    expect(await store.resolve('/r', 'https://github.com/alice/own.git')).toMatchObject({ account: { login: 'alice' }, access: 'push' })
    expect(await store.resolve('/r', 'https://github.com/other/private.git')).toMatchObject({ account: null, access: 'none' })
    expect(await store.envFor('/r', 'https://github.com/other/private.git')).toBeUndefined()
    expect(await store.resolve('/r', 'git@github.com:team/app.git')).toEqual({ github: false })
    // Access answers are cached.
    const n = api.calls.length
    await store.resolve('/r', 'https://github.com/team/app.git')
    expect(api.calls.length).toBe(n)
  })

  it('a pinned choice wins, system means no token, and removing an account unpins it', async () => {
    const store = new GitHubAccounts({ crypt, fetch: fakeApi({ 'team/app': { alice: 'read', bob: 'push' } }).fetch })
    await store.add(TOK_A)
    await store.add(TOK_B)
    const alice = store.list().find((a) => a.login === 'alice')!
    expect(store.setChoice('/r', alice.id)).toBe(true)
    expect(await store.resolve('/r', 'https://github.com/team/app.git')).toMatchObject({ choice: alice.id, account: { login: 'alice' }, access: 'read' })
    const env = await store.envFor('/r', 'https://github.com/team/app.git')
    expect(env?.GIT_CONFIG_VALUE_1 ?? Object.values(env ?? {}).join()).toContain(Buffer.from(`x-access-token:${TOK_A}`).toString('base64'))
    expect(store.setChoice('/r', 'system')).toBe(true)
    expect(await store.envFor('/r', 'https://github.com/team/app.git')).toBeUndefined()
    expect(store.setChoice('/r', 'nope')).toBe(false)
    store.setChoice('/r', alice.id)
    expect(store.remove(alice.id)).toBe(true)
    expect(store.choiceOf('/r')).toBe('auto')
    expect(store.list()).toMatchObject([{ login: 'bob', isDefault: true }])
  })
})
