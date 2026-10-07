import { spawn } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
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

/** Opens a folder the collector already tracks; arguments go straight to the executable, never through a shell. */
export async function openFolder(dir: string, app: OpenApp, spawner: Spawner = defaultSpawner): Promise<OpenResult> {
  if (process.platform !== 'win32' && spawner === defaultSpawner) return 'unsupported'
  const st = await stat(dir).catch(() => null)
  if (!st?.isDirectory()) return 'notFound'
  try {
    if (app === 'explorer') {
      await spawner('explorer.exe', [path.normalize(dir)])
      return 'ok'
    }
    const code = await findVsCode()
    if (!code) return 'noApp'
    await spawner(code, [path.normalize(dir)])
    return 'ok'
  } catch {
    return 'failed'
  }
}
