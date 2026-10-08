import path from 'node:path'

/** Per-user data dir for the collector; `scripts/statusline-bridge.mjs` `defaultDataDir` must stay identical. */
export function defaultDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'ccm')
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'ccm')
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'ccm')
}
