import { spawn } from 'node:child_process'
import { lstatSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { childEnv } from '../pty/presets'
import { resolveCommand, withArgs, type ResolvedCommand } from '../run/resolve'

export interface CodewhaleInstall {
  /** What runs `codewhale …`: the real binary when known, else the PATH entry (npm shim through cmd.exe on Windows). */
  cmd: ResolvedCommand
  /** npm wrapper whose first run still has to download the release binary. */
  needsDownload: boolean
  origin: InstallOrigin
  /** npm: the wrapper itself; running it after an upgrade fetches the matching binary. */
  wrapper?: ResolvedCommand
}

export type InstallOrigin = 'npm' | 'winget' | 'standalone'

export interface FsProbe {
  isFile: (p: string) => boolean
  realpath: (p: string) => string
}

const realFs: FsProbe = {
  isFile: (p) => {
    try {
      return statSync(p).isFile()
    } catch {
      try {
        // WinGet Links / WindowsApps entries are reparse points stat() may refuse.
        return lstatSync(p).isSymbolicLink()
      } catch {
        return false
      }
    }
  },
  realpath: (p) => {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  },
}

/** GUI launches often lack the user's npm / winget / script folders on PATH. */
export function extraDirs(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return [
      env.APPDATA ? path.win32.join(env.APPDATA, 'npm') : null,
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links') : null,
    ].filter((d): d is string => !!d)
  }
  return [path.posix.join(home, '.local', 'bin'), path.posix.join(home, '.codewhale', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
}

function withExtra(env: NodeJS.ProcessEnv, dirs: string[], platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const sep = platform === 'win32' ? ';' : ':'
  const cur = env.PATH ?? env.Path ?? ''
  return { ...env, PATH: [cur, ...dirs].filter(Boolean).join(sep), Path: undefined }
}

/** The npm wrapper keeps the downloaded binary in `<pkg>/bin/downloads/`. */
export function wrapperDownloads(found: string, platform: NodeJS.Platform, probe: FsProbe = realFs): string | null {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'win32' && /\.(cmd|ps1)$/i.test(found)) return p.join(p.dirname(found), 'node_modules', 'codewhale', 'bin', 'downloads')
  if (platform === 'win32' && /\.exe$/i.test(found)) return null
  const real = probe.realpath(found)
  return /\.js$/i.test(real) ? p.join(p.dirname(real), 'downloads') : null
}

/** PATH (absolute entries only, never the project cwd) + the usual install folders. */
export function findCodewhale(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform = process.platform, probe: FsProbe = realFs): CodewhaleInstall | null {
  const lookup = withExtra(env, extraDirs(env, home, platform), platform)
  const cmd = resolveCommand('codewhale', home, lookup, platform, probe.isFile)
  if (!cmd) return null
  const found = cmd.verbatim ? cmdFile(cmd) : cmd.file
  const downloads = found ? wrapperDownloads(found, platform, probe) : null
  if (!downloads) return { cmd, needsDownload: false, origin: found && /[\\/]Microsoft[\\/]WinGet[\\/]/i.test(found) ? 'winget' : 'standalone' }
  const exe = (platform === 'win32' ? path.win32 : path.posix).join(downloads, platform === 'win32' ? 'codewhale.exe' : 'codewhale')
  return probe.isFile(exe) ? { cmd: { file: exe, args: [] }, needsDownload: false, origin: 'npm', wrapper: cmd } : { cmd, needsDownload: true, origin: 'npm', wrapper: cmd }
}

export const WINGET_UPGRADE_ARGS = ['upgrade', '--id', 'HunterBown.CodeWhale', '-e', '--accept-source-agreements', '--accept-package-agreements']
export const NPM_UPGRADE_ARGS = ['i', '-g', 'codewhale@latest']

/** Upgrade by how it was installed; the npm route is followed by one wrapper run that downloads the new binary. */
export function updatePlan(cw: CodewhaleInstall, env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform, probe: FsProbe = realFs): InstallStep[] | null {
  if (cw.origin === 'npm') {
    const npm = findTool('npm', env, home, platform, probe)
    return npm ? [{ cmd: withArgs(npm, NPM_UPGRADE_ARGS), display: `npm ${NPM_UPGRADE_ARGS.join(' ')}` }] : null
  }
  if (cw.origin === 'winget') {
    const winget = platform === 'win32' ? findWinget(env, home, probe) : null
    return winget ? [{ cmd: withArgs(winget, WINGET_UPGRADE_ARGS), display: `winget ${WINGET_UPGRADE_ARGS.join(' ')}` }] : null
  }
  return [{ cmd: withArgs(cw.cmd, ['update']), display: 'codewhale update' }]
}

/** The .cmd path inside a cmdShim line (`"/d /s /c "C:\…\codewhale.cmd""`), carets removed. */
function cmdFile(cmd: ResolvedCommand): string | null {
  const line = cmd.args[3]
  if (!line) return null
  return line.slice(1, -1).replace(/\^(.)/g, '$1').trim() || null
}

export function findTool(name: string, env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform, probe: FsProbe = realFs): ResolvedCommand | null {
  return resolveCommand(name, home, withExtra(env, platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin'], platform), platform, probe.isFile)
}

/** winget.exe is an App Execution Alias in WindowsApps, often not on a GUI app's PATH. */
export function findWinget(env: NodeJS.ProcessEnv, home: string, probe: FsProbe = realFs): ResolvedCommand | null {
  if (env.LOCALAPPDATA) {
    const alias = path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winget.exe')
    if (probe.isFile(alias)) return { file: alias, args: [] }
  }
  return findTool('winget', env, home, 'win32', probe)
}

export type InstallRoute = 'winget' | 'npm' | 'script'

export interface InstallStep {
  cmd: ResolvedCommand
  /** Shown in the native confirm. */
  display: string
}

export interface InstallPlan {
  route: InstallRoute
  steps: InstallStep[]
}

export const WINGET_ARGS = ['install', '--id', 'HunterBown.CodeWhale', '-e', '--accept-source-agreements', '--accept-package-agreements']
export const NPM_ARGS = ['i', '-g', 'codewhale']
export const INSTALL_SCRIPT = 'curl -fsSL https://codewhale.net/install.sh | sh'

/** Windows: winget, else npm. macOS / Linux: npm, else the official script (the only shell-string route). */
export function installPlan(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform, probe: FsProbe = realFs): InstallPlan | null {
  if (platform === 'win32') {
    const winget = findWinget(env, home, probe)
    if (winget) return { route: 'winget', steps: [{ cmd: withArgs(winget, WINGET_ARGS), display: `winget ${WINGET_ARGS.join(' ')}` }] }
  }
  const npm = findTool('npm', env, home, platform, probe)
  if (npm) return { route: 'npm', steps: [{ cmd: withArgs(npm, NPM_ARGS), display: `npm ${NPM_ARGS.join(' ')}` }] }
  if (platform === 'win32') return null
  return { route: 'script', steps: [{ cmd: { file: '/bin/sh', args: ['-c', INSTALL_SCRIPT] }, display: INSTALL_SCRIPT }] }
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
  cancelled?: boolean
  spawnError?: boolean
}

export interface RunOpts {
  cwd: string
  timeout: number
  /** Written then closed; never logged. Without it stdin is closed at once. */
  stdin?: string
  onLine?: (line: string) => void
  signal?: AbortSignal
}

export type CliRunner = (cmd: ResolvedCommand, args: string[], opts: RunOpts) => Promise<RunResult>

const OUT_CAP = 256 * 1024

export function cliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...childEnv(env), NO_COLOR: '1' }
}

export function defaultRunner(env: NodeJS.ProcessEnv): CliRunner {
  const vars = cliEnv(env)
  return (base, args, opts) =>
    new Promise((resolve) => {
      let cmd: ResolvedCommand
      try {
        cmd = args.length ? withArgs(base, args) : base
      } catch {
        resolve({ code: null, stdout: '', stderr: '', spawnError: true })
        return
      }
      const child = spawn(cmd.file, cmd.args, { cwd: opts.cwd, env: vars, windowsHide: true, shell: false, windowsVerbatimArguments: !!cmd.verbatim, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let partial = ''
      let timedOut = false
      let cancelled = false
      const feed = (chunk: string): void => {
        if (!opts.onLine) return
        const parts = (partial + chunk).split(/\r\n|\r|\n/)
        partial = parts.pop() ?? ''
        for (const l of parts) if (l.trim()) opts.onLine(l)
      }
      child.stdout.setEncoding('utf8').on('data', (d: string) => {
        if (stdout.length < OUT_CAP) stdout += d
        feed(d)
      })
      child.stderr.setEncoding('utf8').on('data', (d: string) => {
        if (stderr.length < OUT_CAP) stderr += d
        feed(d)
      })
      child.stdin.on('error', () => undefined)
      if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
      else child.stdin.end()
      const kill = (): void => {
        if (process.platform === 'win32' && child.pid) spawn(path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
        else child.kill('SIGTERM')
      }
      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, opts.timeout)
      const onAbort = (): void => {
        cancelled = true
        kill()
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      child.on('error', () => {
        clearTimeout(timer)
        resolve({ code: null, stdout, stderr, spawnError: true })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        if (partial.trim()) opts.onLine?.(partial)
        resolve({ code, stdout, stderr, timedOut, cancelled })
      })
    })
}

