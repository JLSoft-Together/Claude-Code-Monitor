import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type ShimAgent = 'claude' | 'codex'
export const SHIM_AGENTS: readonly ShimAgent[] = ['claude', 'codex']

// claude's subcommands (2.1.289 `claude --help`, plus older `config` / `migrate-installer`): their options are their own, so no flag is added.
export const CLAUDE_SUBCOMMANDS = [
  'agents', 'attach', 'auth', 'auto-mode', 'config', 'doctor', 'gateway', 'import', 'install', 'kill', 'logs', 'mcp',
  'migrate-installer', 'plugin', 'plugins', 'purge', 'respawn', 'rm', 'setup-token', 'stop', 'ultrareview', 'update', 'upgrade',
]
// A session picked by the user (or a version / help call) gets no `--session-id`.
const KEEP_ID = ['-r', '--resume', '-c', '--continue', '--session-id', '--from-pr']
const NO_INJECT = ['-v', '--version', '-h', '--help']

const NOT_FOUND = (agent: ShimAgent): string => `orrery: ${agent} not found in PATH`

/**
 * POSIX shim. `--mcp-config` is variadic, so it goes last; after a `--` nothing is added. The real CLI is the first
 * `agent` on PATH outside this folder, so a profile that prepends another dir later still reaches the right binary.
 */
function posixShim(agent: ShimAgent): string {
  const find = [
    '#!/bin/sh',
    'self=${0%/*}',
    'real=',
    'old_ifs=$IFS',
    'IFS=:',
    'set -f',
    'for d in $PATH; do',
    '  [ -n "$d" ] && [ "$d" != "$self" ] || continue',
    `  if [ -f "$d/${agent}" ] && [ -x "$d/${agent}" ]; then real=$d/${agent}; break; fi`,
    'done',
    'set +f',
    'IFS=$old_ifs',
    `if [ -z "$real" ]; then printf '%s\\n' '${NOT_FOUND(agent)}' >&2; exit 127; fi`,
  ]
  if (agent === 'codex')
    return [
      ...find,
      'if [ -n "${ORRERY_API-}" ] && [ -n "${ORRERY_TOKEN-}" ]; then',
      '  exec "$real" -c "mcp_servers.orrery.url=$ORRERY_API/mcp" -c mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN "$@"',
      'fi',
      'exec "$real" "$@"',
      '',
    ].join('\n')
  return [
    ...find,
    'inject=1',
    'keep=',
    `case "\${1-}" in ${CLAUDE_SUBCOMMANDS.join('|')}) inject= ;; esac`,
    'for a in "$@"; do',
    '  case "$a" in',
    '    --) inject=; break ;;',
    `    ${NO_INJECT.join('|')}) inject= ;;`,
    `    ${KEEP_ID.map((f) => (f.startsWith('--') ? `${f}|${f}=*` : f)).join('|')}) keep=1 ;;`,
    '  esac',
    'done',
    '[ -n "$inject" ] || exec "$real" "$@"',
    'if [ -z "$keep" ]; then',
    "  sid=$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \\n' | sed -n 's/^\\(.\\{8\\}\\)\\(.\\{4\\}\\).\\(.\\{3\\}\\).\\(.\\{3\\}\\)\\(.\\{12\\}\\)$/\\1-\\2-4\\3-a\\4-\\5/p')",
    '  if [ -n "$sid" ]; then set -- "$@" --session-id "$sid"; fi',
    'fi',
    'if [ -n "${ORRERY_MCP_CONFIG-}" ] && [ -f "$ORRERY_MCP_CONFIG" ]; then set -- "$@" --mcp-config "$ORRERY_MCP_CONFIG"; fi',
    'exec "$real" "$@"',
    '',
  ].join('\n')
}

/**
 * Windows shim for PowerShell / cmd. `where $PATH:` never looks in the current folder (a project could plant a
 * claude.cmd there). Arguments pass through `%*` untouched; like npm's own claude.cmd, an unquoted `& | < > ^` in
 * an argument is read by cmd. The uuid comes from PowerShell: cmd's %RANDOM% is seeded per second, two panes
 * starting in the same second would get the same id.
 */
function windowsShim(agent: ShimAgent): string {
  const head = [
    '@echo off',
    'setlocal EnableExtensions DisableDelayedExpansion',
    'set "__orr_real="',
    `for /f "delims=" %%P in ('where "$PATH:${agent}" 2^>nul') do if not defined __orr_real if /i not "%%~dpP"=="%~dp0" (`,
    '  if /i "%%~xP"==".exe" set "__orr_real=%%P"',
    '  if /i "%%~xP"==".cmd" set "__orr_real=%%P"',
    '  if /i "%%~xP"==".bat" set "__orr_real=%%P"',
    ')',
    `if not defined __orr_real (echo ${NOT_FOUND(agent)}>&2& exit /b 9009)`,
  ]
  if (agent === 'codex')
    return [
      ...head,
      'if not defined ORRERY_API goto plain',
      'if not defined ORRERY_TOKEN goto plain',
      '"%__orr_real%" -c "mcp_servers.orrery.url=%ORRERY_API%/mcp" -c mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN %*',
      'exit /b %ERRORLEVEL%',
      ':plain',
      '"%__orr_real%" %*',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n')
  return [
    ...head,
    'set "__orr_inject=1"',
    'set "__orr_keep="',
    'set "__orr_first=1"',
    ':scan',
    'if "%~1"=="" goto run',
    'set "__orr_a=%~1"',
    `if defined __orr_first for %%S in (${CLAUDE_SUBCOMMANDS.join(' ')}) do if "%__orr_a%"=="%%S" set "__orr_inject="`,
    'set "__orr_first="',
    'if "%__orr_a%"=="--" (set "__orr_inject=" & goto run)',
    `for %%F in (${NO_INJECT.join(' ')}) do if "%__orr_a%"=="%%F" set "__orr_inject="`,
    `for %%F in (${KEEP_ID.join(' ')}) do if "%__orr_a%"=="%%F" set "__orr_keep=1"`,
    ...KEEP_ID.filter((f) => f.startsWith('--')).map((f) => `if "%__orr_a:~0,${f.length + 1}%"=="${f}=" set "__orr_keep=1"`),
    'shift',
    'goto scan',
    ':run',
    'if not defined __orr_inject (',
    '  "%__orr_real%" %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    'set "__orr_tail="',
    'if defined __orr_keep goto mcp',
    `for /f "delims=" %%G in ('"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command [guid]::NewGuid^(^).Guid') do set "__orr_tail=--session-id %%G"`,
    ':mcp',
    'if defined ORRERY_MCP_CONFIG if exist "%ORRERY_MCP_CONFIG%" set "__orr_tail=%__orr_tail% --mcp-config "%ORRERY_MCP_CONFIG%""',
    '"%__orr_real%" %* %__orr_tail%',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n')
}

export function shimFiles(platform: NodeJS.Platform): Record<string, string> {
  const win = platform === 'win32'
  return Object.fromEntries(SHIM_AGENTS.map((a) => [win ? `${a}.cmd` : a, win ? windowsShim(a) : posixShim(a)]))
}

/** Writes the shims (only when changed); false when the folder is not writable, so shell panes run without them. */
export function writeShims(dir: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of Object.entries(shimFiles(platform))) {
      const file = path.join(dir, name)
      let current = ''
      try {
        current = readFileSync(file, 'utf8')
      } catch {
        // first run
      }
      if (current !== body) writeFileSync(file, body, { mode: 0o755 })
      if (platform !== 'win32') chmodSync(file, 0o755)
    }
    return true
  } catch {
    return false
  }
}

/** Shim folder next to the shell init folder, else next to the MCP config: always inside the app's data dir. */
export function shimDirFor(initDir: string | undefined, mcpFile: string): string | undefined {
  const base = initDir && path.isAbsolute(initDir) ? path.dirname(initDir) : mcpFile && path.isAbsolute(mcpFile) ? path.dirname(mcpFile) : ''
  return base ? path.join(base, 'shell-shim') : undefined
}

/** PATH with the shim folder first (any older copy of it dropped), under the key the env already uses. */
export function shimPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, dir: string): Record<string, string> {
  const win = platform === 'win32'
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? (win ? 'Path' : 'PATH')
  const sep = win ? ';' : ':'
  const same = (d: string): boolean => (win ? d.toLowerCase() === dir.toLowerCase() : d === dir)
  const rest = (env[key] ?? '').split(sep).filter((d) => d && !same(d))
  return { [key]: [dir, ...rest].join(sep) }
}
