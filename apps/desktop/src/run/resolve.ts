import { statSync } from 'node:fs'
import path from 'node:path'

export interface ResolvedCommand {
  file: string
  args: string[]
  verbatim?: boolean
}

// cmd.exe metacharacters; same escaping as cross-spawn.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g
const CONTROL = /[\r\n\0]/

/** cmd.exe ends the command at a line break and C strings at NUL: such an argument can't be passed through a .bat safely. */
export class BadArgError extends Error {
  readonly code = 'bad-arg'
  constructor() {
    super('bad-arg')
  }
}

const checked = (s: string): string => {
  if (CONTROL.test(s)) throw new BadArgError()
  return s
}

/** One argv entry for a batch file run by `cmd /d /s /c "…"`: MSVCRT quoting, then cmd metachars caret-escaped twice (cmd re-parses for the .bat). */
export function quoteCmdArg(arg: string): string {
  let s = checked(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  s = `"${s}"`
  return s.replace(CMD_META, '^$1').replace(CMD_META, '^$1')
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Batch files can't be spawned without a shell: wrap in `cmd.exe /d /s /c "<quoted line>"` (spawn with verbatim).
 * Throws `BadArgError` for a path / argument holding CR, LF or NUL.
 */
export function cmdShim(file: string, args: readonly string[], env: NodeJS.ProcessEnv): ResolvedCommand {
  const cmd = path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'cmd.exe')
  const line = [checked(file).replace(CMD_META, '^$1'), ...args.map(quoteCmdArg)].join(' ')
  return { file: cmd, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
}

/**
 * `name` → spawnable command. Absolute/relative paths are taken as is (relative to cwd); bare names walk
 * PATH ourselves (+ PATHEXT on win32) so the project cwd is never searched first.
 */
export function resolveCommand(name: string, cwd: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = isFile): ResolvedCommand | null {
  const p = platform === 'win32' ? path.win32 : path.posix
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase()) : ['']
  const withExt = (base: string): string | null => {
    if (platform === 'win32' && p.extname(base) && exists(base)) return base
    for (const e of exts) if (exists(base + e)) return base + e
    return null
  }
  let found: string | null = null
  if (name.includes('/') || name.includes('\\')) found = withExt(p.resolve(cwd, name))
  else {
    const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter((d) => d && p.isAbsolute(d))
    for (const d of dirs) if ((found = withExt(p.join(d, name)))) break
  }
  if (!found) return null
  return platform === 'win32' && /\.(bat|cmd)$/i.test(found) ? cmdShim(found, [], env) : { file: found, args: [] }
}

/** Appends args to a resolved command, keeping the cmd.exe line quoted. Throws `BadArgError` like `cmdShim`. */
export function withArgs(cmd: ResolvedCommand, args: readonly string[]): ResolvedCommand {
  if (!cmd.verbatim) return { ...cmd, args: [...cmd.args, ...args] }
  const line = cmd.args[3] ?? '""'
  return { ...cmd, args: [...cmd.args.slice(0, 3), `${line.slice(0, -1)} ${args.map(quoteCmdArg).join(' ')}"`] }
}
