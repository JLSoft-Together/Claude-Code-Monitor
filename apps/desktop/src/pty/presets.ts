import path from 'node:path'
import { isAgentSessionId, type PtyPreset } from '../../../../packages/shared/src/pty'

export interface LaunchSpec {
  file: string
  args: string[]
  /** Added to the child env (shell hooks that report the current folder). */
  env?: Record<string, string>
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
function agentCommand(preset: Exclude<PtyPreset, 'shell'>, resume?: string): string {
  if (!resume || !isAgentSessionId(resume)) return preset
  return preset === 'claude' ? `claude --resume ${resume}` : `codex resume ${resume}`
}

/**
 * Shells report their folder after every prompt so links and the branch chip follow `cd`: PowerShell via
 * Windows Terminal's OSC 9;9, bash/zsh via OSC 7. `initDir` holds the zsh startup wrappers (see shellInit.ts).
 */
export function presetCommand(preset: PtyPreset, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, resume?: string, initDir?: string): LaunchSpec {
  if (platform === 'win32') {
    const file = windowsPowerShell(env.SystemRoot ?? env.SYSTEMROOT)
    const script = preset === 'shell' ? PS_CWD_HOOK : `${PS_CWD_HOOK}; ${agentCommand(preset, resume)}`
    // Encoded: no quoting rules between node-pty's command line and PowerShell's parser to get wrong.
    return { file, args: ['-NoLogo', '-NoExit', '-EncodedCommand', encodePowerShell(script)] }
  }
  const shell = safeShell(env.SHELL, platform)
  const hook = posixHook(shell, env, initDir)
  if (preset === 'shell') return { file: shell, args: ['-l'], env: hook.env }
  return { file: shell, args: ['-l', '-i', '-c', `${agentCommand(preset, resume)}; ${hook.reexec}${shell} -l`], env: hook.env }
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
    if (k.startsWith('CCM_') || k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS' || AGENT_SESSION_VARS.has(k)) continue
    out[key] = value
  }
  out.TERM = 'xterm-256color'
  out.COLORTERM = 'truecolor'
  return out
}
