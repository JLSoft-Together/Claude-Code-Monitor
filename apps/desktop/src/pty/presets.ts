import path from 'node:path'
import { isAgentSessionId, type PtyPreset } from '../../../../packages/shared/src/pty'

export interface LaunchSpec {
  file: string
  args: string[]
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

export function presetCommand(preset: PtyPreset, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, resume?: string): LaunchSpec {
  if (platform === 'win32') {
    const file = windowsPowerShell(env.SystemRoot ?? env.SYSTEMROOT)
    if (preset === 'shell') return { file, args: ['-NoLogo'] }
    return { file, args: ['-NoLogo', '-NoExit', '-Command', agentCommand(preset, resume)] }
  }
  const shell = safeShell(env.SHELL, platform)
  if (preset === 'shell') return { file: shell, args: ['-l'] }
  return { file: shell, args: ['-l', '-i', '-c', `${agentCommand(preset, resume)}; exec ${shell} -l`] }
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
