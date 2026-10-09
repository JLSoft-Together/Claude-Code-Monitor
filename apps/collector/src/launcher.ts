import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { LaunchErrorCode, LaunchMode, TerminalApp } from '@ccm/shared'
import { parseOsaError, runCommand, type Runner } from './osascript'

export type Spawner = (command: string, args: string[], cwd: string) => Promise<void>

// Fixed command line: the directory is passed as cwd / -d only, never interpolated into a shell string.
const claudeArgs = (mode: LaunchMode): string[] => ['-NoLogo', '-NoExit', '-Command', mode === 'continue' ? 'claude --continue' : 'claude']

const defaultSpawner: Spawner = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env
    const child = spawn(command, args, { cwd, env, detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

/** wt.exe treats `;` as a sub-command separator, so such paths go straight to a console window. */
const wtSafe = (dir: string): boolean => !/[;"]/.test(dir)

export class LaunchError extends Error {
  constructor(readonly code: Exclude<LaunchErrorCode, 'notFound'>) {
    super(`launch ${code}`)
  }
}

export const hasControlChars = (s: string): boolean => /[\x00-\x1f\x7f]/.test(s)

const LAUNCH_TIMEOUT_MS = 60_000

const SHELL_LINE = 'set cmdLine to "cd " & quoted form of (item 1 of argv) & " && " & (item 2 of argv)'

export const TERMINAL_LAUNCH_SCRIPT = `on run argv
  ${SHELL_LINE}
  tell application id "com.apple.Terminal"
    do script cmdLine
    activate
  end tell
end run`

export const ITERM_LAUNCH_SCRIPT = `on run argv
  ${SHELL_LINE}
  tell application id "com.googlecode.iterm2"
    set w to (create window with default profile)
    tell current session of w to write text cmdLine
    activate
  end tell
end run`

export function launchArgs(app: TerminalApp, dir: string, mode: LaunchMode): string[] {
  return ['-e', app === 'iterm' ? ITERM_LAUNCH_SCRIPT : TERMINAL_LAUNCH_SCRIPT, dir, mode === 'continue' ? 'claude --continue' : 'claude']
}

export async function launchClaude(
  dir: string,
  mode: LaunchMode,
  spawner: Spawner = defaultSpawner,
  terminalApp: TerminalApp = 'terminal',
  platform: NodeJS.Platform = process.platform,
  run: Runner = (command, args) => runCommand(command, args, LAUNCH_TIMEOUT_MS),
): Promise<void> {
  const mac = platform === 'darwin'
  if (!mac && platform !== 'win32' && spawner === defaultSpawner) throw new Error('unsupported platform')
  const st = await stat(dir).catch(() => null)
  if (!st?.isDirectory()) throw new Error('directory not found')
  if (mac) {
    if (hasControlChars(dir)) throw new LaunchError('failed')
    const r = await run('osascript', launchArgs(terminalApp, dir, mode))
    if (r.code === 0) return
    const code = parseOsaError(r.stderr)
    throw new LaunchError(code === 'denied' || code === 'notInstalled' ? code : 'failed')
  }
  if (wtSafe(dir)) {
    try {
      await spawner('wt.exe', ['-w', '0', 'nt', '-d', dir, 'powershell.exe', ...claudeArgs(mode)], dir)
      return
    } catch {
      // Windows Terminal not installed → plain console below.
    }
  }
  await spawner('powershell.exe', claudeArgs(mode), dir)
}
