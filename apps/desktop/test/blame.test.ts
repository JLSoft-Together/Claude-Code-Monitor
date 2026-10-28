import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findGit } from '../src/pty/git'
import { blame, parseBlame } from '../src/preview/blame'

const git = findGit()

describe('parseBlame', () => {
  it('reads headers once per commit and marks uncommitted lines', () => {
    const a = 'a'.repeat(40)
    const out = [`${a} 1 1 2`, 'author Ann', 'author-time 1700000000', 'summary first', 'filename x', '\tone', `${a} 2 2`, '\ttwo', `${'0'.repeat(40)} 3 3 1`, 'author Not Committed Yet', '\tthree', ''].join('\n')
    const r = parseBlame(out)
    expect(r.lines).toEqual([a, a, ''])
    expect(r.commits[a]).toEqual({ author: 'Ann', time: 1700000000000, summary: 'first' })
    expect(Object.keys(r.commits)).toEqual([a])
  })
})

describe.skipIf(!git)('blame', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'ccm-blame-'))
  const run = (...args: string[]) => execFileSync(git!, args, { cwd: repo, encoding: 'utf8' })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it('blames a tracked file and refuses outside paths', async () => {
    run('init', '-q')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 'Tess')
    writeFileSync(path.join(repo, 'f.txt'), 'a\nb\n')
    run('add', '.')
    run('commit', '-q', '-m', 'add f')
    writeFileSync(path.join(repo, 'f.txt'), 'a\nb\nc\n')
    const r = await blame(repo, path.join(repo, 'f.txt'))
    if (!r.ok) throw new Error(r.error)
    expect(r.lines).toHaveLength(3)
    expect(r.lines[2]).toBe('')
    expect(r.commits[r.lines[0]!]).toMatchObject({ author: 'Tess', summary: 'add f' })
    writeFileSync(path.join(repo, 'new.txt'), 'x\n')
    expect(await blame(repo, path.join(repo, 'new.txt'))).toMatchObject({ ok: false, error: 'untracked' })
    expect(await blame(repo, path.join(os.tmpdir(), 'x.txt'))).toMatchObject({ ok: false, error: 'denied' })
  })
})
