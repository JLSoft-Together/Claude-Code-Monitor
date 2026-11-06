import path from 'node:path'
import { isAgentSessionId, type PtyPreset } from '../../../../packages/shared/src/pty'
import { BASH_INIT_FILE } from './shellInit'
import { shimPath } from './shim'

export interface LaunchSpec {
  file: string
  args: string[]
  /** Added to the child env (shell hooks that report the current folder). */
  env?: Record<string, string>
  /** The shell was started with command marks (OSC 633) keyed to `AgentOptions.shellNonce`. */
  integrated?: boolean
}

// Absolute paths: a bare name would resolve through PATH/cwd, which a project folder could shadow.
const windowsPowerShell = (systemRoot: string | undefined): string =>
  path.win32.join(systemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export function safeShell(shellEnv: string | undefined, platform: NodeJS.Platform): string {
  if (shellEnv && path.posix.isAbsolute(shellEnv) && /^[\w./+-]+$/.test(shellEnv)) return shellEnv
  return platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

/**
 * Agents start inside the user's shell so PATH/profile apply and the pane survives the agent exiting
 * (Ctrl+C out of claude leaves a prompt, not a dead pane).
 */
function agentCommand(preset: Exclude<PtyPreset, 'shell'>, win: boolean, resume?: string, opts: AgentOptions = {}): string {
  const resumed = !!resume && isAgentSessionId(resume)
  if (preset === 'codex') {
    // Codex needs a literal url (no ${VAR} expansion in config); the bearer comes from the env var it names. A -c value that is not valid TOML is taken as a raw string.
    const mcp = opts.mcp ? ` -c ${win ? '"mcp_servers.orrery.url=$env:ORRERY_API/mcp"' : '"mcp_servers.orrery.url=$ORRERY_API/mcp"'} -c mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN` : ''
    return resumed ? `codex${mcp} resume ${resume}` : `codex${mcp}`
  }
  // A positional prompt would be submitted at once; the page types it into the input box instead. MCP comes via DEEPSEEK_MCP_CONFIG.
  if (preset === 'deepseek') return resumed ? `codewhale --skip-onboarding -r ${resume}` : 'codewhale --skip-onboarding'
  const base = resumed
    ? `claude --resume ${resume}`
    : `claude${isAgentSessionId(opts.sessionId) ? ` --session-id ${opts.sessionId}` : ''}${isPaneName(opts.name) ? ` -n '${opts.name}'` : ''}`
  return opts.mcp ? `${base} --mcp-config ${win ? '$env:ORRERY_MCP_CONFIG' : '"$ORRERY_MCP_CONFIG"'}` : base
}

/** Page-minted id of a new claude pane; a resume or an open ticket already decides the session. */
export const mintedSessionId = (preset: PtyPreset, session: unknown, resume: unknown, ticketed: boolean): string | undefined =>
  preset === 'claude' && resume === undefined && !ticketed && isAgentSessionId(session) ? session : undefined

export interface AgentOptions {
  sessionId?: string
  name?: string
  mcp?: boolean
  /** DeepSeek panes with `mcp`: the per-host Codewhale MCP file (user's servers + orrery), see deepseekMcp.ts. */
  deepseekMcpConfig?: string
  /** Shell panes only: per-session secret that turns on command marks; an E mark without it is not trusted. */
  shellNonce?: string
  /** Shell panes only: folder of the `claude` / `codex` shims (shim.ts), put first on PATH. */
  shimDir?: string
}

const isNonce = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16,64}$/.test(v)

/** Owner pause (2026-11-03): without CCM_DEEPSEEK_FEATURE=1 no DeepSeek pane is spawned, so Codewhale never runs. */
export const presetEnabled = (preset: PtyPreset, deepseek: boolean): boolean => preset !== 'deepseek' || deepseek

export const isPaneName =(v: unknown): v is string => typeof v === 'string' && v.trim() === v && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u.test(v)

export const MCP_CONFIG_JSON = JSON.stringify({
  mcpServers: { orrery: { type: 'http', url: '${ORRERY_API}/mcp', headers: { Authorization: 'Bearer ${ORRERY_TOKEN}' } } },
})

/**
 * Shells report their folder after every prompt so links and the branch chip follow `cd`: PowerShell via
 * Windows Terminal's OSC 9;9, bash/zsh via OSC 7. `initDir` holds the zsh startup wrappers (see shellInit.ts).
 */
export function presetCommand(preset: PtyPreset, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, resume?: string, initDir?: string, opts?: AgentOptions): LaunchSpec {
  const shim = preset === 'shell' ? shimEnv(env, platform, opts?.shimDir) : undefined
  if (platform === 'win32') {
    const file = windowsPowerShell(env.SystemRoot ?? env.SYSTEMROOT)
    const nonce = preset === 'shell' && isNonce(opts?.shellNonce) ? opts.shellNonce : undefined
    const shellHook = shim ? `${PS_CWD_HOOK}\n${PS_SHIM_FIRST}` : PS_CWD_HOOK
    if (nonce)
      return { file, args: ['-NoLogo', '-NoExit', '-EncodedCommand', encodePowerShell(`${shellHook}\n${PS_SHELL_INTEGRATION}`)], env: { ...shim, ORRERY_SI_NONCE: nonce }, integrated: true }
    if (preset === 'shell') return { file, args: ['-NoLogo', '-NoExit', '-EncodedCommand', encodePowerShell(shellHook)], ...(shim ? { env: shim } : {}) }
    const script = `${PS_CWD_HOOK}; ${agentCommand(preset, true, resume, opts)}`
    const extra = agentEnv(preset, opts)
    // Encoded: no quoting rules between node-pty's command line and PowerShell's parser to get wrong.
    return { file, args: ['-NoLogo', '-NoExit', '-EncodedCommand', encodePowerShell(script)], ...(extra ? { env: extra } : {}) }
  }
  const shell = safeShell(env.SHELL, platform)
  const hook = posixHook(shell, env, initDir)
  if (preset === 'shell') {
    const nonce = isNonce(opts?.shellNonce) ? opts.shellNonce : undefined
    const name = path.posix.basename(shell)
    if (nonce && name === 'bash' && initDir)
      return { file: shell, args: ['--init-file', path.posix.join(initDir, BASH_INIT_FILE), '-i'], env: { ...hook.env, ...shim, ORRERY_SI_NONCE: nonce }, integrated: true }
    if (nonce && name === 'zsh' && hook.env?.ZDOTDIR) return { file: shell, args: ['-l'], env: { ...hook.env, ...shim, ORRERY_SI_NONCE: nonce }, integrated: true }
    return { file: shell, args: ['-l'], env: shim ? { ...hook.env, ...shim } : hook.env }
  }
  const extra = agentEnv(preset, opts)
  return { file: shell, args: ['-l', '-i', '-c', `${agentCommand(preset, false, resume, opts)}; ${hook.reexec}${shell} -l`], env: extra ? { ...hook.env, ...extra } : hook.env }
}

/**
 * Codewhale installed from Settings after the app started is missing from the PATH the app inherited (winget / npm
 * update the registry or profile only), so DeepSeek panes also look in the install locations that exist.
 */
export function codewhalePath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string, exists: (dir: string) => boolean): Record<string, string> {
  const win = platform === 'win32'
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? (win ? 'Path' : 'PATH')
  const sep = win ? ';' : ':'
  const p = win ? path.win32 : path.posix
  const current = (env[key] ?? '').split(sep).filter(Boolean)
  const have = new Set(current.map((d) => (win ? d.toLowerCase().replace(/[\\/]+$/, '') : d)))
  const dirs = win
    ? [env.APPDATA && p.join(env.APPDATA, 'npm'), env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')]
    : [p.join(home, '.codewhale', 'bin'), p.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  const extra = dirs.filter((d): d is string => !!d && p.isAbsolute(d) && !have.has(win ? d.toLowerCase() : d) && exists(d))
  return extra.length ? { [key]: [...current, ...extra].join(sep) } : {}
}

function shimEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, dir: string | undefined): Record<string, string> | undefined {
  const abs = platform === 'win32' ? path.win32.isAbsolute(dir ?? '') : path.posix.isAbsolute(dir ?? '')
  return dir && abs ? { ...shimPath(env, platform, dir), ORRERY_SHIM_DIR: dir } : undefined
}

function agentEnv(preset: PtyPreset, opts: AgentOptions | undefined): Record<string, string> | undefined {
  const file = opts?.deepseekMcpConfig
  return preset === 'deepseek' && opts?.mcp && file && path.isAbsolute(file) ? { DEEPSEEK_MCP_CONFIG: file } : undefined
}

// Wraps whatever prompt the profile defined (oh-my-posh, starship…) and appends the folder; the visible prompt is unchanged.
export const PS_CWD_HOOK = [
  'if (-not $global:__AgentMonitorPrompt) {',
  '$global:__AgentMonitorPrompt = $function:prompt',
  'function global:prompt {',
  "$out = (& $global:__AgentMonitorPrompt) -join ''",
  '$loc = $executionContext.SessionState.Path.CurrentLocation',
  "if ($loc.Provider.Name -eq 'FileSystem') { $out += \"$([char]27)]9;9;`\"$($loc.ProviderPath)`\"$([char]27)\\\" }",
  '$out',
  '}',
  '}',
].join('\n')

// Runs after the profile and the folder hook: wraps the resulting prompt (oh-my-posh, starship keep working).
// `$?` is read first and put back (Write-Error -ErrorAction Ignore) before the user's prompt runs, as VS Code does.
// PSConsoleHostReadLine (PSReadLine) reports the line about to run; without PSReadLine no command is marked.
// Any error leaves the shell as the profile made it.
export const PS_SHELL_INTEGRATION = [
  'try {',
  'if ($env:ORRERY_SI_NONCE -and -not $global:__OrrerySI) {',
  '$global:__OrrerySI = @{ Nonce = $env:ORRERY_SI_NONCE; Prompt = $function:prompt; ReadLine = $null; LastId = -1; Running = $false }',
  'Remove-Item Env:ORRERY_SI_NONCE -ErrorAction SilentlyContinue',
  "function global:__Orrery-Escape([string]$value) { [regex]::Replace($value, '[\\x00-\\x1f\\x7f\\\\;]', { param($m) '\\x{0:x2}' -f [int][char]$m.Value }) }",
  'if (Get-Command PSConsoleHostReadLine -CommandType Function -ErrorAction SilentlyContinue) {',
  '$global:__OrrerySI.ReadLine = $function:PSConsoleHostReadLine',
  'function global:PSConsoleHostReadLine {',
  '$si = $global:__OrrerySI',
  '$line = & $si.ReadLine',
  '$si.Running = $true',
  '$cmd = __Orrery-Escape $line',
  '[Console]::Write("$([char]27)]633;E;$cmd;$($si.Nonce)$([char]7)$([char]27)]633;C$([char]7)")',
  '$line',
  '}',
  '}',
  'function global:prompt {',
  '$failed = -not $global:?',
  '$code = $global:LASTEXITCODE',
  '$si = $global:__OrrerySI',
  '$h = Get-History -Count 1',
  '$id = if ($h) { $h.Id } else { 0 }',
  "$out = ''",
  'if ($si.Running) {',
  '$si.Running = $false',
  'if ($id -eq $si.LastId) { $out += "$([char]27)]633;D$([char]7)" }',
  'else {',
  '$n = if (-not $failed) { 0 } elseif ($code -is [int] -and $code -ne 0) { $code } else { 1 }',
  '$out += "$([char]27)]633;D;$n$([char]7)"',
  '}',
  '}',
  '$si.LastId = $id',
  '$out += "$([char]27)]633;A$([char]7)"',
  "if ($failed) { Write-Error 'failure' -ErrorAction Ignore }",
  "$out += (& $si.Prompt) -join ''",
  '$out + "$([char]27)]633;B$([char]7)"',
  '}',
  '}',
  '} catch { }',
].join('\n')

// A profile that rebuilds $env:Path (machine + user values) would drop the shim folder the pane started with.
export const PS_SHIM_FIRST =
  "if ($env:ORRERY_SHIM_DIR) { $env:Path = (@($env:ORRERY_SHIM_DIR) + @($env:Path -split ';' | Where-Object { $_ -and $_ -ne $env:ORRERY_SHIM_DIR })) -join ';' }"

export const encodePowerShell = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

export const BASH_PROMPT_COMMAND = "printf '\\e]7;file://%s%s\\e\\\\' \"$HOSTNAME\" \"$PWD\""

/** zsh has no env hook: ZDOTDIR points at wrappers that source the user's files, then add a precmd. */
function posixHook(shell: string, env: NodeJS.ProcessEnv, initDir?: string): { env?: Record<string, string>; reexec: string } {
  const name = path.posix.basename(shell)
  if (name === 'bash') return { env: { PROMPT_COMMAND: BASH_PROMPT_COMMAND }, reexec: 'exec ' }
  if (name !== 'zsh' || !initDir || initDir.includes("'")) return { reexec: 'exec ' }
  const user = env.ZDOTDIR && path.posix.isAbsolute(env.ZDOTDIR) ? env.ZDOTDIR : ''
  return {
    env: { ZDOTDIR: initDir, AGENT_MONITOR_ZDOTDIR: user },
    // The agent's shell restored the user's ZDOTDIR; the shell left after it exits needs the wrappers again.
    reexec: `exec /usr/bin/env ZDOTDIR='${initDir}' AGENT_MONITOR_ZDOTDIR="\${ZDOTDIR:-$HOME}" `,
  }
}

/** pty.log line for a pane whose process ended soon after spawn; Windows crash statuses print as NTSTATUS hex (0xC0000142). */
export function earlyExitNote(preset: PtyPreset, code: number, signal: number | undefined, ms: number, killed: boolean): string {
  const hex = code < 0 || code > 0x7fffffff ? ` (0x${(code >>> 0).toString(16).toUpperCase()})` : ''
  return `pty early exit: preset=${preset} code=${code}${hex}${signal ? ` signal=${signal}` : ''} after=${ms}ms${killed ? ' killed-by-app' : ''}`
}

export function taskkillPath(env: NodeJS.ProcessEnv): string {
  return path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'taskkill.exe')
}

export function clampDim(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : fallback
}

/** Child env: drop our own secrets and anything that would inject code into a Node/Electron child. */
// Set by a running agent for its own children. Inherited (app started from inside a session), they make a
// pane's claude a "child session" that skips transcripts and the registry, and leak the parent's messaging token.
const AGENT_SESSION_VARS = new Set([
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
  'CODEX_THREAD_ID',
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
])

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    const k = key.toUpperCase()
    if (k.startsWith('CCM_') || k.startsWith('ORRERY_') || k.startsWith('GOLAIM_') || k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS' || AGENT_SESSION_VARS.has(k)) continue
    out[key] = value
  }
  out.TERM = 'xterm-256color'
  out.COLORTERM = 'truecolor'
  // Claude Code (supports-hyperlinks) then prints links as OSC 8, which survive its own line wrapping.
  out.FORCE_HYPERLINK = '1'
  return out
}
