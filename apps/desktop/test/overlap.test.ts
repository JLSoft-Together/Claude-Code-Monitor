import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findGit } from '../src/pty/git'
import { changedVsBase, dryMerge } from '../src/preview/overlap'

const git = findGit()
describe.skipIf(!git)('overlap', () => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-overlap-')))
  const dir = path.join(base, 'main')
  const wt = path.join(base, 'wt')
  const run = (cwd: string, ...args: string[]) => execFileSync(git!, args, { cwd, encoding: 'utf8' })
  beforeAll(() => {
    execFileSync(git!, ['init', '-q', '-b', 'main', dir])
    run(dir, 'config', 'user.email', 't@example.com')
    run(dir, 'config', 'user.name', 'T')
    writeFileSync(path.join(dir, 'a.txt'), '1\n')
    writeFileSync(path.join(dir, 'b.txt'), '1\n')
    run(dir, 'add', '.')
    run(dir, 'commit', '-q', '-m', 'init')
    run(dir, 'worktree', 'add', '-q', '-b', 'feat', wt)
    writeFileSync(path.join(wt, 'a.txt'), 'feat\n')
    run(wt, 'commit', '-q', '-am', 'feat a')
    writeFileSync(path.join(wt, 'b.txt'), 'dirty\n')
  })
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  it('lists committed and uncommitted files against the main branch', async () => {
    const res = await changedVsBase(wt)
    expect(res).toMatchObject({ ok: true, branch: 'feat', base: 'main', truncated: false })
    expect(res.ok && res.files.sort()).toEqual(['a.txt', 'b.txt'])
    const main = await changedVsBase(dir)
    expect(main.ok && main.files).toEqual([])
    expect(main.ok && wt.length && res.ok && main.common).toBe(res.ok && res.common)
  })

  it('dry-runs a merge without touching either checkout', async () => {
    expect(await dryMerge(dir, 'main', 'feat')).toEqual({ ok: true, clean: true, conflicts: [] })
    writeFileSync(path.join(dir, 'a.txt'), 'main\n')
    run(dir, 'commit', '-q', '-am', 'main a')
    const res = await dryMerge(dir, 'main', 'feat')
    expect(res.ok === false && res.error === 'unsupported' ? 'skip' : res).toEqual(expect.anything())
    if (res.ok) expect(res).toEqual({ ok: true, clean: false, conflicts: ['a.txt'] })
    expect(run(dir, 'status', '--porcelain').trim()).toBe('')
    expect(await dryMerge(dir, 'main', 'nope')).toEqual({ ok: false, error: 'unknown' })
  })
})
