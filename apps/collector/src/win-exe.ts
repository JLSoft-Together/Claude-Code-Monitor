import { lstatSync, statSync } from 'node:fs'
import path from 'node:path'

// Windows resolves a bare exe name against the child's cwd before PATH; for spawns whose cwd is a project
// folder that lets a repo-planted wt.exe / powershell.exe / git.exe run instead. Always spawn absolute paths.

export function windowsPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

const isFile = (file: string): boolean => {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** PATH lookup over absolute entries only (never the cwd); null when not found. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, extraDirs: string[] = []): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => d && path.isAbsolute(d))
  for (const dir of [...dirs, ...extraDirs]) {
    const file = path.join(dir, name)
    if (isFile(file)) return file
  }
  return null
}

/** wt.exe is an App Execution Alias (reparse point stat() cannot follow), so the WindowsApps entry is checked with lstat. */
export function windowsTerminal(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.LOCALAPPDATA) {
    const alias = path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe')
    try {
      lstatSync(alias)
      return alias
    } catch {
      // not installed for this user
    }
  }
  return findOnPath('wt.exe', env)
}
