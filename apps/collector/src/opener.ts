import { spawn } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { OpenApp, OpenResult } from '@ccm/shared'

export type Spawner = (command: string, args: string[]) => Promise<void>

const defaultSpawner: Spawner = (command, args) =>
  new Promise((resolve, reject) => {
    // Inherited from a VS Code terminal, this would start Code.exe as plain Node instead of the editor.
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false, env })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  )

// `code` on PATH is a .cmd shim, which Node only runs through a shell; Code.exe sits one level above its bin folder.
export async function findVsCode(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const candidates: string[] = []
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (/[\\/]bin[\\/]?$/i.test(dir)) candidates.push(path.join(dir, '..', 'Code.exe'))
  }
  if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'))
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)']]) if (root) candidates.push(path.join(root, 'Microsoft VS Code', 'Code.exe'))
  for (const file of candidates) if (await exists(file)) return path.normalize(file)
  return null
}

async function findOnPath(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (dir && (await exists(path.join(dir, name)))) return path.join(dir, name)
  }
  return null
}

type Command = [file: string, args: string[]]

async function vsCodeCommand(dir: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<Command | null> {
  if (platform === 'win32') {
    const code = await findVsCode(env)
    return code ? [code, [dir]] : null
  }
  const cli = await findOnPath('code', env)
  if (cli) return [cli, [dir]]
  if (platform !== 'darwin') return null
  // The `code` shell command is opt-in on macOS; the app bundle opens folders through LaunchServices.
  for (const root of ['/Applications', path.join(env.HOME ?? os.homedir(), 'Applications')]) {
    const bundle = path.join(root, 'Visual Studio Code.app')
    if (await exists(bundle)) return ['/usr/bin/open', ['-a', bundle, dir]]
  }
  return null
}

const folderCommand = (dir: string, platform: NodeJS.Platform): Command =>
  platform === 'win32' ? ['explorer.exe', [dir]] : platform === 'darwin' ? ['/usr/bin/open', [dir]] : ['xdg-open', [dir]]

/** Opens a folder the collector already tracks; arguments go straight to the executable, never through a shell. */
export async function openFolder(
  dir: string,
  app: OpenApp,
  spawner: Spawner = defaultSpawner,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OpenResult> {
  if (!['win32', 'darwin', 'linux'].includes(platform)) return 'unsupported'
  const st = await stat(dir).catch(() => null)
  if (!st?.isDirectory()) return 'notFound'
  const target = path.normalize(dir)
  try {
    const command = app === 'explorer' ? folderCommand(target, platform) : await vsCodeCommand(target, platform, env)
    if (!command) return 'noApp'
    await spawner(...command)
    return 'ok'
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'noApp' : 'failed'
  }
}
