import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findGit } from '../src/pty/git'
import { CheckpointStore } from '../src/preview/checkpoints'

const git = findGit()

describe.skipIf(!git)('CheckpointStore', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ccm-cp-'))
  const repo = path.join(base, 'repo')
  const data = path.join(base, 'data')
  const run = (...args: string[]) => execFileSync(git!, args, { cwd: repo, encoding: 'utf8' })
  const store = new CheckpointStore(data)
  const trashed: string[] = []
  const trash = async (abs: string) => {
    trashed.push(abs)
    rmSync(abs)
  }

  beforeAll(() => {
    mkdirSync(repo, { recursive: true })
    run('init', '-q')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 'T')
    writeFileSync(path.join(repo, '.gitignore'), 'skip/\n')
    writeFileSync(path.join(repo, 'a.txt'), 'one\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
  })
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  it('does nothing until turned on', async () => {
    expect(await store.take(repo, 'turn 1')).toEqual({ ok: false, error: 'off' })
    expect(await store.list(repo)).toEqual([])
  })

  it('snapshots, skips an unchanged tree, diffs and restores without touching the repo index', async () => {
    await store.setOn(repo, true)
    writeFileSync(path.join(repo, 'a.txt'), 'two\n')
    mkdirSync(path.join(repo, 'skip'))
    writeFileSync(path.join(repo, 'skip', 'x.txt'), 'ignored')
    const first = await store.take(repo, 'before turn 2')
    expect(first.ok && first.id).toBeTruthy()
    expect(await store.take(repo, 'same')).toEqual({ ok: true, id: null })

    writeFileSync(path.join(repo, 'a.txt'), 'broken\n')
    writeFileSync(path.join(repo, 'new.txt'), 'n\n')
    const [cp] = await store.list(repo)
    const diff = await store.diff(repo, cp!.id)
    expect(diff.ok && diff.files.map((f) => `${f.status} ${f.path}`).sort()).toEqual(['A new.txt', 'M a.txt'])

    expect(await store.restore(repo, cp!.id, ['a.txt', 'new.txt'], trash)).toEqual({ ok: true })
    expect(readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('two\n')
    expect(existsSync(path.join(repo, 'new.txt'))).toBe(false)
    expect(trashed).toHaveLength(1)
    expect(run('diff', '--cached', '--name-only').trim()).toBe('')
    expect(await store.restore(repo, cp!.id, ['../x'], trash)).toMatchObject({ ok: false, error: 'denied' })
  })

  it('reviews a turn: diff between two checkpoints, undo one hunk, refuse a stale one', async () => {
    const lines = (n: number, edit: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => edit[i] ?? `l${i}`).join('\n') + '\n'
    writeFileSync(path.join(repo, 'b.txt'), lines(30))
    const before = await store.take(repo, 'before:t')
    writeFileSync(path.join(repo, 'b.txt'), lines(30, { 2: 'A', 25: 'B' }))
    const after = await store.take(repo, 'after:t')
    if (!before.ok || !after.ok || !before.id || !after.id) throw new Error('no checkpoints')
    const files = await store.diff(repo, before.id, after.id)
    expect(files.ok && files.files.map((f) => f.path)).toEqual(['b.txt'])
    const d = await store.fileDiff(repo, before.id, after.id, 'b.txt')
    if (!d.ok) throw new Error(d.error)
    const second = d.text.slice(d.text.lastIndexOf('@@ -'))
    expect(await store.revertHunk(repo, 'b.txt', second)).toEqual({ ok: true })
    expect(readFileSync(path.join(repo, 'b.txt'), 'utf8')).toBe(lines(30, { 2: 'A' }))
    expect(await store.revertHunk(repo, 'b.txt', second)).toMatchObject({ ok: false, error: 'stale' })
    expect(await store.fileDiff(repo, before.id, after.id, '../x')).toMatchObject({ ok: false })
    expect(run('diff', '--cached', '--name-only').trim()).toBe('')
  })

  it('turning off deletes the store', async () => {
    await store.setOn(repo, false)
    expect(await store.list(repo)).toEqual([])
  })
})
