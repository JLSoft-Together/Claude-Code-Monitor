import path from 'node:path'
import { isAgentSessionId, type PtyPreset } from '../../../../packages/shared/src/pty'
import { BASH_INIT_FILE } from './shellInit'

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
  if (preset === 'codex') return resumed ? `codex resume ${resume}` : 'codex'
  const base = resumed
    ? `claude --resume ${resume}`
    : `claude${isAgentSessionId(opts.sessionId) ? ` --session-id ${opts.sessionId}` : ''}${isPaneName(opts.name) ? ` -n '${opts.name}'` : ''}`
  return opts.mcp ? `${base} --mcp-config ${win ? '$env:ORRERY_MCP_CONFIG' : '"$ORRERY_MCP_CONFIG"'}` : base
}

export interface AgentOptions {
  sessionId?: string
  name?: string
  mcp?: boolean
  /** Shell panes only: per-session secret that turns on command marks; an E mark without it is not trusted. */
  shellNonce?: string
}

const isNonce = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16,64}$/.test(v)

export const isPaneName = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u.test(v)

export const MCP_CONFIG_JSON = JSON.stringify({
  mcpServers: { orrery: { type: 'http', url: '${ORRERY_API}/mcp', headers: { Authorization: 'Bearer ${ORRERY_TOKEN}' } } },
})

/**
 * Shells report their folder after every prompt so links and the branch chip follow `cd`: PowerShell via
 * Windows Terminal's OSC 9;9, bash/zsh via OSC 7. `initDir` holds the zsh startup wrappers (see shellInit.ts).
 */
export function presetCommand(preset: PtyPreset, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, resume?: string, initDir?: string, opts?: AgentOptions): LaunchSpec {
  if (platform === 'win32') {
    const file = windowsPowerShell(env.SystemRoot ?? env.SYSTEMROOT)
    const nonce = preset === 'shell' && isNonce(opts?.shellNonce) ? opts.shellNonce : undefined
    if (nonce)
      return { file, args: ['-NoLogo', '-NoExit', '-EncodedCommand', encodePowerShell(`${PS_CWD_HOOK}\n${PS_SHELL_INTEGRATION}`)], env: { ORRERY_SI_NONCE: nonce }, integrated: true }
    const script = preset === 'shell' ? PS_CWD_HOOK : `${PS_CWD_HOOK}; ${agentCommand(preset, true, resume, opts)}`
    // Encoded: no quoting rules between node-pty's command line and PowerShell's parser to get wrong.
    return { file, args: ['-NoLogo', '-NoExit', '-EncodedCommand', encodePowerShell(script)] }
  }
  const shell = safeShell(env.SHELL, platform)
  const hook = posixHook(shell, env, initDir)
  if (preset === 'shell') {
    const nonce = isNonce(opts?.shellNonce) ? opts.shellNonce : undefined
    const name = path.posix.basename(shell)
    if (nonce && name === 'bash' && initDir)
      return { file: shell, args: ['--init-file', path.posix.join(initDir, BASH_INIT_FILE), '-i'], env: { ...hook.env, ORRERY_SI_NONCE: nonce }, integrated: true }
    if (nonce && name === 'zsh' && hook.env?.ZDOTDIR) return { file: shell, args: ['-l'], env: { ...hook.env, ORRERY_SI_NONCE: nonce }, integrated: true }
    return { file: shell, args: ['-l'], env: hook.env }
  }
  return { file: shell, args: ['-l', '-i', '-c', `${agentCommand(preset, false, resume, opts)}; ${hook.reexec}${shell} -l`], env: hook.env }
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
