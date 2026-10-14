import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isHash } from '@ccm/shared'
import { branchesContaining, cleanLogQuery, commitDetail, commitDiff, FS, listRefs, logArgs, logPage, parseLog, parseNameStatus, parseRefLines, parseTrack } from '../src/preview/log'
import { findGit } from '../src/pty/git'

const ROOT = process.platform === 'win32' ? 'C:\\repo' : '/repo'

describe('log parsers', () => {
  it('parses NUL-separated log records', () => {
    const rec = (...f: string[]) => f.join(FS)
    const out = [rec('a'.repeat(40), `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'Ann', 'ann@x', '1700000000', 'HEAD -> main, tag: v1', 'Merge x'), rec('b'.repeat(40), '', 'Bo', 'bo@x', '1690000000', '', 'init'), ''].join('\0')
    expect(parseLog(out)).toEqual([
      { hash: 'a'.repeat(40), parents: ['b'.repeat(40), 'c'.repeat(40)], author: 'Ann', email: 'ann@x', time: 1700000000, refs: 'HEAD -> main, tag: v1', subject: 'Merge x' },
      { hash: 'b'.repeat(40), parents: [], author: 'Bo', email: 'bo@x', time: 1690000000, refs: '', subject: 'init' },
    ])
  })

  it('reads upstream tracking', () => {
    expect(parseTrack('ahead 2, behind 1')).toEqual({ ahead: 2, behind: 1, gone: false })
    expect(parseTrack('behind 3')).toEqual({ ahead: 0, behind: 3, gone: false })
    expect(parseTrack('gone')).toEqual({ ahead: 0, behind: 0, gone: true })
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0, gone: false })
  })

  it('groups refs, peels annotated tags and skips remote HEAD', () => {
    const line = (...f: string[]) => f.join(FS)
    const h = (c: string) => c.repeat(40)
    const out = [
      line('refs/heads/main', h('a'), '', 'origin/main', 'ahead 1'),
      line('refs/heads/feature/x', h('b'), '', '', ''),
      line('refs/remotes/origin/HEAD', h('a'), '', '', ''),
      line('refs/remotes/origin/main', h('a'), '', '', ''),
      line('refs/remotes/my/fork/dev', h('c'), '', '', ''),
      line('refs/tags/v1', h('d'), h('e'), '', ''),
      '',
    ].join('\n')
    const r = parseRefLines(out, ['origin', 'my/fork'])
    expect(r.local).toEqual([
      { ref: 'refs/heads/main', name: 'main', hash: h('a'), upstream: 'origin/main', ahead: 1, behind: 0, gone: false },
      { ref: 'refs/heads/feature/x', name: 'feature/x', hash: h('b'), upstream: null, ahead: 0, behind: 0, gone: false },
    ])
    expect(r.remotes).toEqual([
      { name: 'my/fork', refs: [{ ref: 'refs/remotes/my/fork/dev', name: 'my/fork/dev', hash: h('c') }] },
      { name: 'origin', refs: [{ ref: 'refs/remotes/origin/main', name: 'origin/main', hash: h('a') }] },
    ])
    expect(r.tags).toEqual([{ ref: 'refs/tags/v1', name: 'v1', hash: h('e') }])
  })

  it('parses name-status -z incl. renames and copies', () => {
    const out = ['M', 'src/a.ts', 'A', 'new.md', 'D', 'gone.txt', 'R087', 'old.ts', 'renamed.ts', 'C100', 'src/a.ts', 'copy.ts', 'T', 'link', 'X', 'odd', ''].join('\0')
    expect(parseNameStatus(out)).toEqual([
      { path: 'src/a.ts', kind: 'modified' },
      { path: 'new.md', kind: 'added' },
      { path: 'gone.txt', kind: 'deleted' },
      { path: 'renamed.ts', origPath: 'old.ts', kind: 'renamed' },
      { path: 'copy.ts', origPath: 'src/a.ts', kind: 'copied' },
      { path: 'link', kind: 'typechange' },
      { path: 'odd', kind: 'modified' },
    ])
  })

  it('accepts hashes only', () => {
    expect(isHash('abcd')).toBe(true)
    expect(isHash('ABCDEF0123')).toBe(true)
    expect(isHash('abc')).toBe(false)
    expect(isHash('-n')).toBe(false)
    expect(isHash('a'.repeat(41))).toBe(false)
  })
})

describe('log query', () => {
  it('keeps known values only', () => {
    const q = cleanLogQuery({ branch: 'refs/heads/main', author: ' Ann ', since: 10, until: 'x', text: '', regex: 1, matchCase: true, paths: ['src', '../etc', 5], skip: 1000.7 }, ROOT)
    expect(q).toEqual({ branch: 'refs/heads/main', author: 'Ann', since: 10, until: null, text: null, regex: false, matchCase: true, paths: ['src'], skip: 1000 })
  })

  it('rejects branch values that are not refs', () => {
    for (const branch of ['--all', '-n1', 'main', 'refs/heads/a..b', 'refs/heads/x y', 'refs/other/x', 'refs/heads/x.lock']) expect(cleanLogQuery({ branch }, ROOT).branch).toBeNull()
    expect(cleanLogQuery({ branch: 'HEAD' }, ROOT).branch).toBe('HEAD')
    expect(cleanLogQuery({ branch: 'refs/remotes/origin/feature/x' }, ROOT).branch).toBe('refs/remotes/origin/feature/x')
  })

  it('builds git args with page strings behind = or --', () => {
    const base = cleanLogQuery({}, ROOT)
    expect(logArgs(base)).toEqual(['log', '--topo-order', '-z', expect.stringMatching(/^--format=/), '--skip=0', '-n', '501', '--branches', '--remotes', '--tags', 'HEAD', '--'])
    const q = cleanLogQuery({ branch: 'refs/heads/main', author: '-n 1', text: '[fix]', since: 1700000000, paths: ['src/a.ts'] }, ROOT)
    const args = logArgs(q)
    expect(args).toContain('--author=-n 1')
    expect(args).toContain('--grep=[fix]')
    expect(args).toContain('--fixed-strings')
    expect(args).toContain('--regexp-ignore-case')
    expect(args).toContain(`--since=${new Date(1700000000 * 1000).toISOString()}`)
    expect(args.slice(args.indexOf('--'))).toEqual(['--', 'src/a.ts'])
    expect(args[args.indexOf('--') - 1]).toBe('refs/heads/main')
  })

  it('escapes the author when the text is a regex', () => {
    const args = logArgs(cleanLogQuery({ author: 'A.B (x)', text: 'fix|feat', regex: true, matchCase: true }, ROOT))
    expect(args).toContain('--author=A\\.B \\(x\\)')
    expect(args).toContain('--extended-regexp')
    expect(args).not.toContain('--regexp-ignore-case')
  })
})

const git = findGit()
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-log-'))
const repo = path.join(tmp, 'repo')
const run = (...args: string[]): string => execFileSync(git!, ['-C', repo, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
const commit = (msg: string, file: string, text: string, author = 'Ann <ann@x>'): string => {
  writeFileSync(path.join(repo, file), text)
  run('add', '-A')
  run('commit', '-q', '-m', msg, `--author=${author}`)
  return run('rev-parse', 'HEAD')
}

describe.skipIf(!git)('git log repo', () => {
  const h: Record<string, string> = {}
  beforeAll(() => {
    mkdirSync(repo, { recursive: true })
    execFileSync(git!, ['init', '-q', '-b', 'main', repo])
    run('config', 'user.email', 'c@x')
    run('config', 'user.name', 'Cy')
    run('config', 'core.autocrlf', 'false')
    h.root = commit('init', 'a.txt', 'one\n')
    run('checkout', '-q', '-b', 'feature/x')
    h.feat = commit('feat: add b [fix]', 'b.txt', 'b\n', 'Bo <bo@x>')
    run('checkout', '-q', 'main')
    h.main2 = commit('main: edit a', 'a.txt', 'one\ntwo\n')
    run('merge', '-q', '--no-ff', '-m', 'Merge feature/x', 'feature/x')
    h.merge = run('rev-parse', 'HEAD')
    run('mv', 'a.txt', 'renamed.txt')
    run('commit', '-q', '-m', 'rename a')
    h.rename = run('rev-parse', 'HEAD')
    run('tag', '-a', 'v1', '-m', 'v1')
    run('update-ref', 'refs/remotes/origin/main', h.main2)
    run('remote', 'add', 'origin', 'https://example.invalid/x.git')
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('lists refs with HEAD, remotes and peeled tags', async () => {
    const r = await listRefs(repo)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.head).toEqual({ branch: 'main', hash: h.rename })
    expect(r.local.map((l) => l.name).sort()).toEqual(['feature/x', 'main'])
    expect(r.remotes).toEqual([{ name: 'origin', refs: [{ ref: 'refs/remotes/origin/main', name: 'origin/main', hash: h.main2 }] }])
    expect(r.tags).toEqual([{ ref: 'refs/tags/v1', name: 'v1', hash: h.rename }])
    expect(r.me).toBe('Cy')
  })

  it('pages the log in topo order and filters', async () => {
    const all = await logPage(repo, {})
    const subjects = all.ok ? all.commits.map((c) => c.subject) : []
    // --topo-order fixes children before parents; the two merged lines may come in either order.
    expect(subjects.slice(0, 2)).toEqual(['rename a', 'Merge feature/x'])
    expect(new Set(subjects.slice(2, 4))).toEqual(new Set(['main: edit a', 'feat: add b [fix]']))
    expect(subjects.at(-1)).toBe('init')
    expect(all.ok && all.more).toBe(false)
    expect(all.ok && all.commits[0]!.refs).toContain('tag: v1')
    const feat = await logPage(repo, { branch: 'refs/heads/feature/x' })
    expect(feat.ok && feat.commits.map((c) => c.subject)).toEqual(['feat: add b [fix]', 'init'])
    const bo = await logPage(repo, { author: 'bo' })
    expect(bo.ok && bo.commits.map((c) => c.hash)).toEqual([h.feat])
    const literal = await logPage(repo, { text: '[fix]' })
    expect(literal.ok && literal.commits.map((c) => c.hash)).toEqual([h.feat])
    const inject = await logPage(repo, { author: '-n 1' })
    expect(inject).toEqual({ ok: true, commits: [], more: false })
    const byPath = await logPage(repo, { paths: ['b.txt'] })
    expect(byPath.ok && byPath.commits.map((c) => c.hash)).toEqual([h.feat])
    const skipped = await logPage(repo, { skip: 4 })
    expect(skipped.ok && skipped.commits.map((c) => c.subject)).toEqual(['init'])
  })

  it('finds a commit by hash prefix first', async () => {
    const r = await logPage(repo, { text: h.feat.slice(0, 8) })
    expect(r.ok && r.commits[0]!.hash).toBe(h.feat)
  })

  it('returns an empty page for a repo without commits', async () => {
    const empty = path.join(tmp, 'empty')
    execFileSync(git!, ['init', '-q', empty])
    expect(await logPage(empty, {})).toEqual({ ok: true, commits: [], more: false })
    const r = await listRefs(empty)
    expect(r.ok && r.head.hash).toBeNull()
  })

  it('details a merge against its first parent, a rename and the root commit', async () => {
    const merge = await commitDetail(repo, h.merge)
    expect(merge.ok && merge.parents).toEqual([h.main2, h.feat])
    expect(merge.ok && merge.files).toEqual([{ path: 'b.txt', kind: 'added', added: 1, removed: 0, binary: false }])
    const ren = await commitDetail(repo, h.rename)
    expect(ren.ok && ren.files).toEqual([expect.objectContaining({ path: 'renamed.txt', origPath: 'a.txt', kind: 'renamed' })])
    const root = await commitDetail(repo, h.root)
    expect(root.ok && root.files).toEqual([{ path: 'a.txt', kind: 'added', added: 1, removed: 0, binary: false }])
    expect(root.ok && root.message.trim()).toBe('init')
    expect(await commitDetail(repo, '-n')).toEqual({ ok: false, error: 'denied' })
    expect(await commitDetail(repo, 'deadbeef')).toEqual({ ok: false, error: 'missing' })
  })

  it('lists branches containing a commit', async () => {
    const r = await branchesContaining(repo, h.main2)
    expect(r.ok && r.branches.sort()).toEqual(['main', 'origin/main'])
  })

  it('diffs one file of a commit vs its first parent', async () => {
    const d = await commitDiff(repo, h.main2, 'a.txt')
    expect(d.ok && d.text).toContain('+two')
    const root = await commitDiff(repo, h.root, 'a.txt')
    expect(root.ok && root.text).toContain('+one')
    expect(await commitDiff(repo, h.main2, '../x')).toEqual({ ok: false, error: 'denied' })
  })
})
