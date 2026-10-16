import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { commonDir } from '../src/preview/changes'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
let hasGit = true
try {
  execFileSync('git', ['--version'], { stdio: 'pipe' })
} catch {
  hasGit = false
}

describe.skipIf(!hasGit)('commonDir', () => {
  it('answers the same .git for the main checkout and its worktree', async () => {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-common-')))
    try {
      const main = path.join(base, 'app')
      fs.mkdirSync(main)
      git(main, 'init', '-q')
      git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
      git(main, 'worktree', 'add', '-q', path.join(base, 'app-wt', 'feat'), '-b', 'feat')
      const a = await commonDir(main)
      const b = await commonDir(path.join(base, 'app-wt', 'feat'))
      expect(a).toBe(path.join(main, '.git'))
      expect(b).toBe(a)
      expect(await commonDir(base)).toBeNull()
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  }, 30_000)
})
