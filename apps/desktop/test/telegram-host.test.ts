import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectDiff, saveInbound } from '../src/telegram/host'

function repo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-git-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  writeFileSync(path.join(dir, '.env'), 'X=1\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  return dir
}

describe('telegram host helpers', () => {
  it('diffs uncommitted changes without secret files', async () => {
    const dir = repo()
    expect(await projectDiff(dir, '', 'linux')).toEqual({ ok: false, error: 'clean' })
    writeFileSync(path.join(dir, 'a.txt'), 'two\n')
    writeFileSync(path.join(dir, '.env'), 'X=2\n')
    const res = await projectDiff(dir, '', 'linux')
    expect(res.ok && res.files).toBe(1)
    expect(res.ok && res.text).toContain('+two')
    expect(res.ok && res.text).not.toContain('X=2')
    expect(await projectDiff(mkdtempSync(path.join(os.tmpdir(), 'tg-nogit-')), '', 'linux')).toEqual({ ok: false, error: 'not-repo' })
  })

  it('saves inbound files under .orrery/telegram and excludes the folder from git', async () => {
    const dir = repo()
    const file = await saveInbound(dir, '../../evil name.png', Buffer.from('x'), new Date(2026, 10, 4, 9, 5, 7))
    expect(file).toBe(path.join(dir, '.orrery', 'telegram', '20261104-090507-_.._evil_name.png'))
    expect(readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8')).toMatch(/^\.orrery\/$/m)
    expect(await saveInbound(dir, '.env', Buffer.from('x'))).toBeNull()
  })
})
