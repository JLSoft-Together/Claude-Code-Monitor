import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { LaunchMode } from '@ccm/shared'

export type Spawner = (command: string, args: string[], cwd: string) => Promise<void>

// Fixed command line: the directory is passed as cwd / -d only, never interpolated into a shell string.
const claudeArgs = (mode: LaunchMode): string[] => ['-NoLogo', '-NoExit', '-Command', mode === 'continue' ? 'claude --continue' : 'claude']

const defaultSpawner: Spawner = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

/** wt.exe treats `;` as a sub-command separator, so such paths go straight to a console window. */
const wtSafe = (dir: string): boolean => !/[;"]/.test(dir)

export async function launchClaude(dir: string, mode: LaunchMode, spawner: Spawner = defaultSpawner): Promise<void> {
  if (process.platform !== 'win32' && spawner === defaultSpawner) throw new Error('unsupported platform')
  const st = await stat(dir).catch(() => null)
  if (!st?.isDirectory()) throw new Error('directory not found')
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
