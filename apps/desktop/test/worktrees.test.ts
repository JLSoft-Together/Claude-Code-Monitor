import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findGit } from '../src/pty/git'
import { copySetupFiles, parsePatterns } from '../src/pty/wtCopy'
import { compareBranch, diffBetween, fileBetween, mergeBranch, mergeCommands, takeFile } from '../src/preview/worktrees'
import { abortMerge, mergeState } from '../src/preview/mergeState'

describe('parsePatterns', () => {
  it('accepts names, prefix globs and deep names only', () => {
    const ps = parsePatterns(['.env*', '**/google-services.json', '../x', 'a/b', '*', 7])
    expect(ps).toHaveLength(2)
    expect(ps[0]!.re.test('.env.local')).toBe(true)
    expect(ps[1]!.deep).toBe(true)
  })
})

describe('copySetupFiles', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ccm-wtcopy-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('copies missing matches, never overwrites, skips node_modules', async () => {
    const main = path.join(root, 'main')
    const dest = path.join(root, 'dest')
    mkdirSync(path.join(main, 'android', 'app'), { recursive: true })
    mkdirSync(path.join(main, 'node_modules', 'x'), { recursive: true })
    mkdirSync(dest, { recursive: true })
    writeFileSync(path.join(main, '.env'), 'A=1')
    writeFileSync(path.join(main, '.env.local'), 'B=2')
    writeFileSync(path.join(main, 'android', 'app', 'google-services.json'), '{}')
    writeFileSync(path.join(main, 'node_modules', 'x', 'google-services.json'), '{}')
    writeFileSync(path.join(dest, '.env'), 'KEEP')
    const copied = await copySetupFiles(main, dest, ['.env*', '**/google-services.json'])
    expect(copied.sort()).toEqual(['.env.local', 'android/app/google-services.json'])
    expect(readFileSync(path.join(dest, '.env'), 'utf8')).toBe('KEEP')
    expect(existsSync(path.join(dest, 'node_modules'))).toBe(false)
  })
})

const git = findGit()
describe.skipIf(!git)('compare and merge a branch', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-wtmerge-'))
  const run = (...args: string[]) => execFileSync(git!, args, { cwd: dir, encoding: 'utf8' })
  const yes = async () => true
  beforeAll(() => {
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 'T')
    writeFileSync(path.join(dir, 'a.txt'), '1\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    run('branch', 'feat')
    run('switch', '-q', 'feat')
    writeFileSync(path.join(dir, 'b.txt'), 'b\n')
    run('add', '.')
    run('commit', '-q', '-m', 'b')
    run('switch', '-q', 'main')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('counts commits ahead and files changed', async () => {
    expect(await compareBranch(dir, 'feat')).toMatchObject({ ok: true, base: 'main', ahead: 1, behind: 0, files: 1, merged: false })
    expect(await compareBranch(dir, 'main')).toMatchObject({ ok: false, error: 'unknown' })
  })

  it('asks first, refuses a dirty base, then fast-forwards', async () => {
    expect(await mergeBranch(dir, 'feat', 'ff', async () => false)).toMatchObject({ ok: false, error: 'cancelled' })
    writeFileSync(path.join(dir, 'a.txt'), 'dirty\n')
    expect(await mergeBranch(dir, 'feat', 'ff', yes)).toMatchObject({ ok: false, error: 'dirty-base' })
    run('checkout', '--', 'a.txt')
    expect(await mergeBranch(dir, 'feat', 'ff', yes)).toMatchObject({ ok: true, mode: 'ff' })
    expect(await compareBranch(dir, 'feat')).toMatchObject({ ok: true, merged: true })
    expect(mergeCommands('main', 'feat', 'squash')).toContain('git merge --squash feat')
  })

  it('keeps a squash conflict for resolving when asked, reports it, then aborts', async () => {
    run('switch', '-q', '-c', 'clash')
    writeFileSync(path.join(dir, 'a.txt'), 'theirs\n')
    run('commit', '-q', '-am', 'theirs')
    run('switch', '-q', 'main')
    writeFileSync(path.join(dir, 'a.txt'), 'ours\n')
    run('commit', '-q', '-am', 'ours')
    expect(await mergeBranch(dir, 'clash', 'squash', yes)).toMatchObject({ ok: false, error: 'conflict' })
    expect(await mergeState(dir)).toEqual({ ok: true, kind: null })
    const kept = await mergeBranch(dir, 'clash', 'squash', yes, true)
    expect(kept).toMatchObject({ ok: false, error: 'conflict', kept: expect.any(String) })
    expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toMatch(/^<<<<<<< /m)
    expect(await mergeState(dir)).toEqual({ ok: true, kind: 'squash' })
    let shown = ''
    expect(await abortMerge(dir, async (_k, cmd) => ((shown = cmd), false))).toEqual({ ok: false, error: 'cancelled' })
    expect(shown).toBe('git reset --merge')
    expect(await abortMerge(dir, yes)).toEqual({ ok: true })
    expect(readFileSync(path.join(dir, 'a.txt'), 'utf8').trim()).toBe('ours')
    expect(await abortMerge(dir, yes)).toEqual({ ok: false, error: 'none' })
  })

  it('lists files between two branch tips, shows one diff, and takes a file after the check', async () => {
    const res = await diffBetween(dir, 'main', 'clash')
    expect(res).toMatchObject({ ok: true, a: 'main', b: 'clash', truncated: false })
    expect(res.ok && res.files).toEqual([{ path: 'a.txt', status: 'M', added: 1, removed: 1, binary: false }])
    expect(await diffBetween(dir, 'main', 'main')).toMatchObject({ ok: false, error: 'unknown' })
    const one = await fileBetween(dir, dir, 'main', 'clash', 'a.txt')
    expect(one.ok && one.text).toMatch(/^-ours$/m)
    expect(await fileBetween(dir, dir, 'main', 'clash', '../x')).toMatchObject({ ok: false, error: 'denied' })
    writeFileSync(path.join(dir, 'a.txt'), 'local edit\n')
    expect(await takeFile(dir, 'clash', 'a.txt', yes)).toEqual({ ok: false, error: 'dirty' })
    run('checkout', '--', 'a.txt')
    expect(await takeFile(dir, 'clash', 'nope.txt', yes)).toEqual({ ok: false, error: 'missing' })
    let shown: string[] = []
    expect(await takeFile(dir, 'clash', 'a.txt', async (lines) => ((shown = lines), false))).toEqual({ ok: false, error: 'cancelled' })
    expect(shown[1]).toBe('git checkout clash -- a.txt')
    expect(await takeFile(dir, 'clash', 'a.txt', yes)).toEqual({ ok: true })
    expect(readFileSync(path.join(dir, 'a.txt'), 'utf8').trim()).toBe('theirs')
  })
})
