import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findGit } from '../src/pty/git'
import { cleanQuery, grepArgs, parseGrep, search } from '../src/preview/search'

describe('search query', () => {
  it('rejects empty, huge or multi-line queries', () => {
    expect(cleanQuery({ q: '' })).toBeNull()
    expect(cleanQuery({ q: 'a\nb' })).toBeNull()
    expect(cleanQuery({ q: 'x'.repeat(501) })).toBeNull()
    expect(cleanQuery({ q: 'foo', regex: 'yes' })).toEqual({ q: 'foo', regex: false, caseSensitive: false, word: false })
  })

  it('passes the query after -e, fixed strings unless regex', () => {
    const args = grepArgs({ q: '-rf', regex: false, caseSensitive: true, word: true })
    expect(args.slice(-2)).toEqual(['-e', '-rf'])
    expect(args).toContain('-F')
    expect(args).toContain('-w')
    expect(args).not.toContain('-i')
  })

  it('parses -z records and caps the count', () => {
    const out = 'a/b.ts\u00002\u00005\u0000const x = 1\r\nc.ts\u000010\u00001\u0000y\n'
    expect(parseGrep(out).matches).toEqual([
      { path: 'a/b.ts', line: 2, col: 5, text: 'const x = 1' },
      { path: 'c.ts', line: 10, col: 1, text: 'y' },
    ])
    expect(parseGrep(out, 1)).toMatchObject({ truncated: true, matches: [{ path: 'a/b.ts' }] })
  })
})

const git = findGit()
describe.skipIf(!git)('search in a repo', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-search-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('finds tracked and untracked files, skips ignored', async () => {
    execFileSync(git!, ['init', '-q'], { cwd: dir })
    writeFileSync(path.join(dir, '.gitignore'), 'skip.txt\n')
    writeFileSync(path.join(dir, 'a.txt'), 'hello world\nHELLO\n')
    writeFileSync(path.join(dir, 'skip.txt'), 'hello\n')
    execFileSync(git!, ['add', 'a.txt', '.gitignore'], { cwd: dir })
    writeFileSync(path.join(dir, 'new.txt'), 'say hello\n')
    const res = await search(dir, { q: 'hello', regex: false, caseSensitive: false, word: false })
    expect(res.ok && res.matches.map((m) => `${m.path}:${m.line}`).sort()).toEqual(['a.txt:1', 'a.txt:2', 'new.txt:1'])
    const none = await search(dir, { q: 'nope', regex: false, caseSensitive: true, word: false })
    expect(none).toEqual({ ok: true, matches: [], truncated: false })
  })

  it('reports a bad regex and honours abort', async () => {
    const bad = await search(dir, { q: '(', regex: true, caseSensitive: true, word: false })
    expect(bad.ok).toBe(false)
    const ctl = new AbortController()
    ctl.abort()
    expect(await search(dir, { q: 'hello', regex: false, caseSensitive: false, word: false }, ctl.signal)).toEqual({ ok: false, error: 'cancelled' })
  })
})
