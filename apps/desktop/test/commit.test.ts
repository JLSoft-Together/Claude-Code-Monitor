import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findGit } from '../src/pty/git'
import { cleanCommit, commit, headUnpushed, stageHunk, stagePaths, unstagePaths } from '../src/preview/commit'

const git = findGit()

describe('cleanCommit', () => {
  it('normalises line ends and rejects bad input', () => {
    expect(cleanCommit({ message: 'a\r\nb', amend: 1 })).toEqual({ message: 'a\nb', opts: { amend: false } })
    expect(cleanCommit({ message: 'x\0' })).toBeNull()
    expect(cleanCommit({})).toBeNull()
  })
})

describe.skipIf(!git)('stage and commit', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-commit-'))
  const run = (...args: string[]) => execFileSync(git!, args, { cwd: dir, encoding: 'utf8' })
  const staged = () => run('diff', '--cached', '--name-only').trim()
  beforeAll(() => {
    run('init', '-q')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 'T')
    run('config', 'core.autocrlf', 'false')
    writeFileSync(path.join(dir, 'a.txt'), '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n')
    run('add', 'a.txt')
    run('commit', '-q', '-m', 'init')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('refuses paths outside the repo', async () => {
    expect(await stagePaths(dir, ['../x'])).toMatchObject({ ok: false, error: 'denied' })
  })

  it('stages, unstages and commits files', async () => {
    writeFileSync(path.join(dir, 'b.txt'), 'new\n')
    expect(await stagePaths(dir, ['b.txt'])).toEqual({ ok: true })
    expect(staged()).toBe('b.txt')
    expect(await unstagePaths(dir, ['b.txt'])).toEqual({ ok: true })
    expect(staged()).toBe('')
    expect(await commit(dir, 'nothing', { amend: false })).toMatchObject({ ok: false, error: 'nothing' })
    await stagePaths(dir, ['b.txt'])
    expect(await commit(dir, '  ', { amend: false })).toMatchObject({ ok: false, error: 'empty-message' })
    const res = await commit(dir, 'Add b\n\nbody', { amend: false })
    expect(res).toMatchObject({ ok: true, subject: 'Add b' })
  })

  it('stages a single hunk', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'one\n2\n3\n4\n5\n6\n7\n8\n9\nten\n')
    const lines = run('diff', '--', 'a.txt').split('\n')
    const at = lines.findIndex((l) => l.startsWith('@@'))
    const next = lines.findIndex((l, i) => i > at && l.startsWith('@@'))
    const hunk = lines.slice(at, next).join('\n')
    expect(await stageHunk(dir, 'a.txt', hunk)).toEqual({ ok: true })
    const cached = run('diff', '--cached', '-U0', '--', 'a.txt')
    expect(cached).toContain('+one')
    expect(cached).not.toContain('+ten')
  })

  it('allows amend only while HEAD is unpushed', async () => {
    expect(await headUnpushed(dir)).toBe(true)
    const res = await commit(dir, 'Add b (amended)', { amend: true })
    expect(res).toMatchObject({ ok: true, subject: 'Add b (amended)' })
  })
})
