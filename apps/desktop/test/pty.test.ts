import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { branchOfHead, isBranchName, isInside, parseWorktrees, worktreeDest } from '../src/pty/git'
import { ownersOf, parsePidTable } from '../src/pty/owners'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import { BASH_PROMPT_COMMAND, childEnv, PS_CWD_HOOK, presetCommand, safeShell } from '../src/pty/presets'
import { writeShellInit, ZSH_FILES } from '../src/pty/shellInit'
import { GrantStore, MAX_GRANTS } from '../src/preview/grants'

const decodePs = (b64: string): string => Buffer.from(b64, 'base64').toString('utf16le')

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
    expect(win.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-EncodedCommand'])
    expect(decodePs(win.args[3]!)).toBe(`${PS_CWD_HOOK}; claude`)
    expect(safeShell('zsh', 'darwin')).toBe('/bin/zsh')
    expect(safeShell('/bin/bash; rm -rf /', 'linux')).toBe('/bin/bash')
  })

  it('keeps app and parent-agent variables out of the child', () => {
    const env = childEnv({ PATH: 'x', CCM_PTY_TOKEN: 't', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--x', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_MESSAGING_TOKEN: 's', CLAUDE_CODE_USE_BEDROCK: '1' })
    expect(Object.keys(env).sort()).toEqual(['CLAUDE_CODE_USE_BEDROCK', 'COLORTERM', 'PATH', 'TERM'])
  })
})

describe('shell folder reports', () => {
  it('PowerShell wraps the profile prompt once and appends OSC 9;9 with the FileSystem path', () => {
    const shell = presetCommand('shell', 'win32', { SystemRoot: 'C:\Windows' })
    expect(shell.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-EncodedCommand'])
    expect(decodePs(shell.args[3]!)).toBe(PS_CWD_HOOK)
    expect(PS_CWD_HOOK).toContain('if (-not $global:__AgentMonitorPrompt)')
    expect(PS_CWD_HOOK).toContain("]9;9;`\"$($loc.ProviderPath)`\"$([char]27)\\")
    const resume = presetCommand('codex', 'win32', {}, '0b3c1f9e-1111-4222-8333-444455556666')
    expect(decodePs(resume.args[3]!).endsWith('; codex resume 0b3c1f9e-1111-4222-8333-444455556666')).toBe(true)
  })

  it('bash gets PROMPT_COMMAND emitting OSC 7', () => {
    const spec = presetCommand('shell', 'linux', { SHELL: '/bin/bash' })
    expect(spec).toEqual({ file: '/bin/bash', args: ['-l'], env: { PROMPT_COMMAND: BASH_PROMPT_COMMAND } })
    expect(BASH_PROMPT_COMMAND).toBe(String.raw`printf '\e]7;file://%s%s\e\\' "$HOSTNAME" "$PWD"`)
  })

  it('zsh points ZDOTDIR at the wrappers and restores them for the shell left after an agent', () => {
    const dir = '/Users/me/Library/Application Support/ccm/shell-init'
    const shell = presetCommand('shell', 'darwin', { SHELL: '/bin/zsh', ZDOTDIR: '/Users/me/.config/zsh' }, undefined, dir)
    expect(shell.env).toEqual({ ZDOTDIR: dir, AGENT_MONITOR_ZDOTDIR: '/Users/me/.config/zsh' })
    const agent = presetCommand('claude', 'darwin', { SHELL: '/bin/zsh' }, undefined, dir)
    expect(agent.args).toEqual(['-l', '-i', '-c', `claude; exec /usr/bin/env ZDOTDIR='${dir}' AGENT_MONITOR_ZDOTDIR="\${ZDOTDIR:-$HOME}" /bin/zsh -l`])
    expect(presetCommand('shell', 'darwin', { SHELL: '/bin/zsh' }).env).toBeUndefined()
    expect(presetCommand('claude', 'darwin', { SHELL: '/bin/zsh' }, undefined, "/tmp/it's").args[3]).toBe('claude; exec /bin/zsh -l')
  })

  it('writes the zsh wrappers', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-zsh-'))
    try {
      expect(writeShellInit(dir)).toBe(true)
      for (const [name, body] of Object.entries(ZSH_FILES)) expect(readFileSync(path.join(dir, name), 'utf8')).toBe(body)
      expect(ZSH_FILES['.zshrc']).toContain('add-zsh-hook precmd __agent_monitor_cwd')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('preview grants', () => {
  it('persists absolute existing folders, newest first, and drops missing ones on load', () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'ccm-grants-'))
    const file = path.join(base, 'data', 'preview-grants.json')
    const a = path.join(base, 'a')
    const b = path.join(base, 'b')
    mkdirSync(a)
    mkdirSync(b)
    try {
      const store = new GrantStore(file)
      store.add(a)
      store.add(b)
      store.add(a)
      store.add('relative/dir')
      store.add(path.parse(base).root)
      store.add(path.join(base, 'missing'))
      expect(store.list()).toEqual([a, b])
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([a, b])
      rmSync(b, { recursive: true })
      expect(new GrantStore(file).list()).toEqual([a])
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([a])
      const again = new GrantStore(file)
      again.clear()
      expect(new GrantStore(file).list()).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('caps the list and lives in memory without a file', () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'ccm-grants-'))
    try {
      const store = new GrantStore()
      for (let i = 0; i < MAX_GRANTS + 5; i++) {
        const d = path.join(base, `d${i}`)
        mkdirSync(d)
        store.add(d)
      }
      expect(store.list()).toHaveLength(MAX_GRANTS)
      expect(store.list()[0]).toBe(path.join(base, `d${MAX_GRANTS + 4}`))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
