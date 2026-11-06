import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { presetCommand } from '../src/pty/presets'
import { BASH_INIT, ZSH_FILES } from '../src/pty/shellInit'
import { CLAUDE_SUBCOMMANDS, shimDirFor, shimFiles, shimPath, writeShims } from '../src/pty/shim'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

// Spaces in both folders: the data dir on macOS is "Application Support", a Windows user name can have one.
function fixture(): { shim: string; real: string; mcp: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'orrery shim '))
  roots.push(root)
  const shim = path.join(root, 'shell shim')
  const real = path.join(root, 'real bin')
  mkdirSync(real)
  const mcp = path.join(root, 'orrery mcp.json')
  writeFileSync(mcp, '{}')
  return { shim, real, mcp }
}

describe('shim files', () => {
  it('writes one shim per agent for the platform, executable on POSIX', () => {
    expect(Object.keys(shimFiles('win32')).sort()).toEqual(['claude.cmd', 'codex.cmd'])
    expect(Object.keys(shimFiles('darwin')).sort()).toEqual(['claude', 'codex'])
    const { shim } = fixture()
    expect(writeShims(shim, 'linux')).toBe(true)
    expect(readFileSync(path.join(shim, 'claude'), 'utf8')).toMatch(/^#!\/bin\/sh\n/)
    if (process.platform !== 'win32') expect(statSync(path.join(shim, 'claude')).mode & 0o111).toBeTruthy()
  })

  it('claude shim: session id unless the user picked a session, MCP config last, subcommands untouched', () => {
    const sh = shimFiles('linux').claude!
    expect(sh).toContain('--session-id "$sid"')
    expect(sh).toContain('-r|--resume|--resume=*|-c|--continue|--continue=*|--session-id|--session-id=*|--from-pr|--from-pr=*) keep=1')
    expect(sh.indexOf('--session-id "$sid"')).toBeLessThan(sh.indexOf('--mcp-config "$ORRERY_MCP_CONFIG"'))
    expect(sh).toContain(`case "\${1-}" in ${CLAUDE_SUBCOMMANDS.join('|')}) inject= ;; esac`)
    const cmd = shimFiles('win32')['claude.cmd']!
    expect(cmd).toContain(`where "$PATH:claude"`)
    expect(cmd).toContain('if "%__orr_a:~0,9%"=="--resume=" set "__orr_keep=1"')
    expect(cmd.split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
  })

  it('codex shim: orrery MCP through -c ahead of the user args', () => {
    expect(shimFiles('linux').codex).toContain('exec "$real" -c "mcp_servers.orrery.url=$ORRERY_API/mcp" -c mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN "$@"')
    expect(shimFiles('win32')['codex.cmd']).toContain('"%__orr_real%" -c "mcp_servers.orrery.url=%ORRERY_API%/mcp" -c mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN %*')
  })

  it('shim folder stays in the app data dir', () => {
    expect(shimDirFor('/data/ccm/shell-init', '/data/ccm/orrery-mcp.json')).toBe(path.join('/data/ccm', 'shell-shim'))
    expect(shimDirFor(undefined, 'C:\\data\\ccm\\orrery-mcp.json')).toBe(path.join('C:\\data\\ccm', 'shell-shim'))
    expect(shimDirFor(undefined, '')).toBeUndefined()
    expect(shimDirFor('relative', 'also/relative')).toBeUndefined()
  })

  it('shimPath: first, once, under the existing key', () => {
    expect(shimPath({ Path: 'C:\\a;C:\\S\\shim;C:\\b' }, 'win32', 'C:\\s\\SHIM')).toEqual({ Path: 'C:\\s\\SHIM;C:\\a;C:\\b' })
    expect(shimPath({ PATH: '/usr/bin:/x/shim' }, 'darwin', '/x/shim')).toEqual({ PATH: '/x/shim:/usr/bin' })
    expect(shimPath({}, 'linux', '/x/shim')).toEqual({ PATH: '/x/shim' })
  })
})

describe('shell pane launch with the shim', () => {
  it('PowerShell: PATH and ORRERY_SHIM_DIR set, PATH put first again after the profile', () => {
    const spec = presetCommand('shell', 'win32', { SystemRoot: 'C:\\Windows', Path: 'C:\\bin' }, undefined, undefined, { shimDir: 'C:\\d\\shell-shim' })
    expect(spec.env).toMatchObject({ Path: 'C:\\d\\shell-shim;C:\\bin', ORRERY_SHIM_DIR: 'C:\\d\\shell-shim' })
    const script = Buffer.from(spec.args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('$env:ORRERY_SHIM_DIR')
    const withMarks = presetCommand('shell', 'win32', { SystemRoot: 'C:\\Windows', Path: 'C:\\bin' }, undefined, undefined, { shimDir: 'C:\\d\\shell-shim', shellNonce: 'a'.repeat(32) })
    expect(withMarks.env).toMatchObject({ ORRERY_SHIM_DIR: 'C:\\d\\shell-shim', ORRERY_SI_NONCE: 'a'.repeat(32) })
    expect(Buffer.from(withMarks.args.at(-1)!, 'base64').toString('utf16le')).toContain('$env:ORRERY_SHIM_DIR')
  })

  it('zsh / bash: env set, init files put the shim first again after the user files', () => {
    const zsh = presetCommand('shell', 'darwin', { SHELL: '/bin/zsh', PATH: '/usr/bin' }, undefined, '/d/shell-init', { shimDir: '/d/App Support/shell-shim' })
    expect(zsh.env).toMatchObject({ PATH: '/d/App Support/shell-shim:/usr/bin', ORRERY_SHIM_DIR: '/d/App Support/shell-shim', ZDOTDIR: '/d/shell-init' })
    expect(ZSH_FILES['.zshrc']).toContain('ORRERY_SHIM_DIR')
    expect(BASH_INIT).toContain('ORRERY_SHIM_DIR')
    const bash = presetCommand('shell', 'linux', { SHELL: '/bin/bash', PATH: '/usr/bin' }, undefined, '/d/shell-init', { shimDir: '/d/shell-shim', shellNonce: 'b'.repeat(32) })
    expect(bash.env).toMatchObject({ PATH: '/d/shell-shim:/usr/bin', ORRERY_SHIM_DIR: '/d/shell-shim', ORRERY_SI_NONCE: 'b'.repeat(32) })
  })

  it('switch off or an agent pane: no shim', () => {
    const off = presetCommand('shell', 'linux', { SHELL: '/bin/bash', PATH: '/usr/bin' }, undefined, '/d/shell-init', {})
    expect(off.env?.PATH).toBeUndefined()
    expect(off.env?.ORRERY_SHIM_DIR).toBeUndefined()
    const agent = presetCommand('claude', 'linux', { SHELL: '/bin/bash', PATH: '/usr/bin' }, undefined, '/d/shell-init', { shimDir: '/d/shell-shim' })
    expect(agent.env?.PATH).toBeUndefined()
    const win = presetCommand('codex', 'win32', { SystemRoot: 'C:\\Windows', Path: 'C:\\bin' }, undefined, undefined, { shimDir: 'C:\\d\\shell-shim' })
    expect(win.env?.Path).toBeUndefined()
  })
})

// Runs the shims for real against a fake CLI that prints its arguments one per line.
// process.env can carry both `Path` and `PATH` (vitest workers); a child must see exactly one.
const envWith = (pathKey: string, value: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH')),
  [pathKey]: value,
  ...extra,
})

const argsOf = (out: string): string[] => out.split(/\r?\n/).filter((l) => l.startsWith('ARG:')).map((l) => l.slice(4))

describe.runIf(process.platform === 'win32')('Windows shim run', () => {
  const { shim, real, mcp } = fixture()
  writeShims(shim, 'win32')
  // Node reads its command line as a real CLI does (cmd's own %1 would split at `=`).
  writeFileSync(path.join(real, 'print.js'), "for (const a of process.argv.slice(2)) console.log('ARG:' + a)\n")
  for (const agent of ['claude', 'codex']) writeFileSync(path.join(real, `${agent}.cmd`), `@"${process.execPath}" "${path.join(real, 'print.js')}" %*\r\n`)
  const vars = { ORRERY_MCP_CONFIG: mcp, ORRERY_API: 'http://127.0.0.1:9', ORRERY_TOKEN: 't' }
  const env = envWith('Path', `${shim};${real};${process.env.SystemRoot}\\System32`, vars)
  // Node refuses a .cmd without a shell; this is the line PowerShell hands cmd for `claude.cmd 'a b' c`.
  const cmdLine = (agent: string, args: string[]): string[] => ['/d', '/s', '/c', `""${path.join(shim, `${agent}.cmd`)}" ${args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ')}"`]
  const run = (agent: string, args: string[], extra: NodeJS.ProcessEnv = env): string[] =>
    argsOf(execFileSync('cmd.exe', cmdLine(agent, args), { env: extra, encoding: 'utf8', windowsVerbatimArguments: true }))

  it('new claude: own args, then --session-id <uuid> and --mcp-config', () => {
    const out = run('claude', ['fix the bug', '--model', 'opus'])
    expect(out.slice(0, 3)).toEqual(['fix the bug', '--model', 'opus'])
    expect(out[3]).toBe('--session-id')
    expect(out[4]).toMatch(UUID)
    expect(out.slice(5)).toEqual(['--mcp-config', mcp])
  }, 20_000)

  it('resume flags: no --session-id; subcommands and --version: nothing added', () => {
    for (const flags of [['--resume', '0b3d9a7e-1111-4222-8333-444455556666'], ['-r'], ['-c'], ['--continue'], ['--session-id=0b3d9a7e-1111-4222-8333-444455556666']])
      expect(run('claude', flags)).toEqual([...flags, '--mcp-config', mcp])
    expect(run('claude', ['mcp', 'list'])).toEqual(['mcp', 'list'])
    expect(run('claude', ['--version'])).toEqual(['--version'])
    expect(run('claude', ['-p', 'x', '--', '-c'])).toEqual(['-p', 'x', '--', '-c'])
  }, 20_000)

  it('codex: orrery MCP first', () => {
    expect(run('codex', ['resume', '--last'])).toEqual(['-c', 'mcp_servers.orrery.url=http://127.0.0.1:9/mcp', '-c', 'mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN', 'resume', '--last'])
  }, 20_000)

  it('no real CLI on PATH: clear error, not itself', () => {
    let err: { status?: number; stderr?: string } = {}
    try {
      execFileSync('cmd.exe', cmdLine('claude', []), { env: envWith('Path', `${shim};${process.env.SystemRoot}\\System32`, vars), encoding: 'utf8', stdio: 'pipe', windowsVerbatimArguments: true })
    } catch (e) {
      err = e as typeof err
    }
    expect(err.status).toBe(9009)
    expect(String(err.stderr)).toContain('claude not found in PATH')
  }, 20_000)
})

const SH = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\sh.exe', 'C:\\Program Files\\Git\\usr\\bin\\sh.exe'].find((f) => existsSync(f)) : '/bin/sh'

describe.runIf(!!SH)('POSIX shim run', () => {
  const { shim, real, mcp } = fixture()
  writeShims(shim, 'linux')
  const fake = "#!/bin/sh\nfor a in \"$@\"; do printf 'ARG:%s\\n' \"$a\"; done\n"
  writeFileSync(path.join(real, 'claude'), fake, { mode: 0o755 })
  writeFileSync(path.join(real, 'codex'), fake, { mode: 0o755 })
  // Git's sh on Windows takes POSIX paths; `cygpath`-like mapping for C:\x\y is /c/x/y.
  const posix = (p: string): string => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p)
  const vars = { ORRERY_MCP_CONFIG: posix(mcp), ORRERY_API: 'http://127.0.0.1:9', ORRERY_TOKEN: 't' }
  const env = envWith('PATH', `${posix(shim)}:${posix(real)}:/usr/bin:/bin`, vars)
  const run = (agent: string, args: string[], extra: NodeJS.ProcessEnv = env): string[] =>
    argsOf(execFileSync(SH!, ['-c', `exec ${agent} "$@"`, agent, ...args], { env: extra, encoding: 'utf8' }))

  it('new claude: own args, then --session-id <uuid> and --mcp-config', () => {
    const out = run('claude', ["it's a \"bug\"", '--model', 'opus'])
    expect(out.slice(0, 3)).toEqual(["it's a \"bug\"", '--model', 'opus'])
    expect(out[3]).toBe('--session-id')
    expect(out[4]).toMatch(UUID)
    expect(out.slice(5)).toEqual(['--mcp-config', posix(mcp)])
  }, 20_000)

  it('resume flags: no --session-id; subcommands, --version and --: nothing added', () => {
    for (const flags of [['--resume', '0b3d9a7e-1111-4222-8333-444455556666'], ['-r'], ['-c'], ['--continue'], ['--from-pr=12']])
      expect(run('claude', flags)).toEqual([...flags, '--mcp-config', posix(mcp)])
    expect(run('claude', ['mcp', 'list'])).toEqual(['mcp', 'list'])
    expect(run('claude', ['-v'])).toEqual(['-v'])
    expect(run('claude', ['-p', 'x', '--', '-c'])).toEqual(['-p', 'x', '--', '-c'])
  }, 20_000)

  it('codex: orrery MCP first; without the token only the user args', () => {
    expect(run('codex', ['exec', 'hi there'])).toEqual(['-c', 'mcp_servers.orrery.url=http://127.0.0.1:9/mcp', '-c', 'mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN', 'exec', 'hi there'])
    expect(run('codex', ['exec'], { ...env, ORRERY_TOKEN: '' })).toEqual(['exec'])
  }, 20_000)

  it('no real CLI on PATH: exit 127 with a clear message', () => {
    let err: { status?: number; stderr?: string } = {}
    try {
      execFileSync(SH!, ['-c', 'exec claude'], { env: envWith('PATH', `${posix(shim)}:/usr/bin:/bin`, vars), encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      err = e as typeof err
    }
    expect(err.status).toBe(127)
    expect(String(err.stderr)).toContain('claude not found in PATH')
  }, 20_000)
})
