import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { branchOfHead, isBranchName, isInside, parseWorktrees, worktreeDest } from '../src/pty/git'
import { ownersOf, parsePidTable } from '../src/pty/owners'
import { childEnv, presetCommand, safeShell } from '../src/pty/presets'

describe('worktrees', () => {
  it('parses porcelain output, first entry is main', () => {
    const out = [
      'worktree F:/work/app',
      'HEAD 56f84ff0000000000000000000000000000000aa',
      'branch refs/heads/master',
      '',
      'worktree F:/work/app-wt/feat-x',
      'HEAD 1111111000000000000000000000000000000000',
      'branch refs/heads/feat/x',
      'locked',
      '',
      'worktree F:/work/app-wt/old',
      'HEAD 2222222000000000000000000000000000000000',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\r\n')
    const list = parseWorktrees(out)
    expect(list.map((w) => [w.branch, w.main, w.locked, w.prunable])).toEqual([
      ['master', true, false, false],
      ['feat/x', false, true, false],
      [undefined, false, false, true],
    ])
    expect(list[0]!.path).toBe(path.normalize('F:/work/app'))
  })

  it('accepts only safe branch names', () => {
    for (const ok of ['feat/x', 'fix-1.2', 'user/name_test']) expect(isBranchName(ok)).toBe(true)
    for (const bad of ['', '-rf', '--orphan', 'a..b', 'a b', 'a~1', 'x.lock', 'a//b', '/a', 'a/', 'a@{1}', '.hidden', 'a:b', 'a\\b']) expect(isBranchName(bad)).toBe(false)
  })

  it('places worktrees next to the main checkout', () => {
    expect(worktreeDest('/work/app', 'feat/x')).toBe(path.join(path.resolve('/work'), 'app-wt', 'feat-x'))
    expect(isInside(path.join('/work/app-wt/a', 'src'), '/work/app-wt/a')).toBe(true)
    expect(isInside('/work/app-wt/ab', '/work/app-wt/a')).toBe(false)
  })

  it('reads branch or detached commit from HEAD', () => {
    expect(branchOfHead('ref: refs/heads/feat/x\n')).toBe('feat/x')
    expect(branchOfHead('56f84ff0000000000000000000000000000000aa')).toBe('56f84ff')
    expect(branchOfHead('garbage')).toBeNull()
  })
})

describe('process ownership', () => {
  it('walks parents up to a terminal shell', () => {
    const table = parsePidTable('10 1\r\n20 10\r\n30 20\r\n40 1\r\n50 50\r\n')
    const owners = ownersOf([30, 40, 50, 99], new Map([[10, 's1']]), table)
    expect([...owners]).toEqual([[30, 's1']])
  })
})

describe('presets', () => {
  it('launches agents inside an absolute-path shell', () => {
    const win = presetCommand('claude', 'win32', { SystemRoot: 'C:\\Windows' })
    expect(win.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(win.args).toEqual(['-NoLogo', '-NoExit', '-Command', 'claude'])
    expect(safeShell('zsh', 'darwin')).toBe('/bin/zsh')
    expect(safeShell('/bin/bash; rm -rf /', 'linux')).toBe('/bin/bash')
  })

  it('keeps app and parent-agent variables out of the child', () => {
    const env = childEnv({ PATH: 'x', CCM_PTY_TOKEN: 't', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--x', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_MESSAGING_TOKEN: 's', CLAUDE_CODE_USE_BEDROCK: '1' })
    expect(Object.keys(env).sort()).toEqual(['CLAUDE_CODE_USE_BEDROCK', 'COLORTERM', 'PATH', 'TERM'])
  })
})
