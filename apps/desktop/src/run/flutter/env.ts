import { execFile } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import type { EnvIssue, FlutterEnv } from '@ccm/shared'
import { isWithin } from '../../preview/paths'
import { cmdShim } from '../resolve'
import { parseFvmConfig } from './detect'

export type FlutterSdkSource = FlutterEnv['source']

export interface FlutterEnvOpts {
  /** User-configured SDK root (SettingsMenu), tried first. */
  setting?: string | null
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  timeoutMs?: number
  /** Explicit Run / pub get: may execute an SDK found inside the project. */
  trusted?: boolean
  /** Repo root holding the project (second boundary for the passive check). */
  repoRoot?: string
}

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
}

export interface EnvDeps {
  isFile(file: string): boolean
  isDir(dir: string): boolean
  readText(file: string): string | null
  readdir(dir: string): string[]
  realpath(file: string): string
  exec(file: string, args: string[], opts: { timeout: number; env: NodeJS.ProcessEnv; windowsVerbatimArguments?: boolean }): Promise<ExecResult>
}

export interface FlutterSdkLookup {
  sdk: string | null
  source: FlutterSdkSource
  /** Version pinned by the project's FVM config, null when none. */
  fvm: string | null
  issues: EnvIssue[]
}

export interface SpawnSpec {
  file: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

const MAX_TEXT = 256 * 1024
const VERSION_TIMEOUT = 60_000

const safeStat = (p: string) => {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

export const nodeEnvDeps: EnvDeps = {
  isFile: (f) => !!safeStat(f)?.isFile(),
  isDir: (d) => !!safeStat(d)?.isDirectory(),
  readText(f) {
    const s = safeStat(f)
    if (!s?.isFile() || s.size > MAX_TEXT) return null
    try {
      return readFileSync(f, 'utf8')
    } catch {
      return null
    }
  },
  readdir(d) {
    try {
      return readdirSync(d).slice(0, 200)
    } catch {
      return []
    }
  },
  realpath(f) {
    try {
      return realpathSync(f)
    } catch {
      return f
    }
  },
  exec: (file, args, opts) =>
    new Promise((resolve) => {
      execFile(file, args, { ...opts, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) =>
        resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }),
      )
    }),
}

const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix)

export const flutterExecutable = (sdk: string, platform: NodeJS.Platform): string =>
  pathFor(platform).join(sdk, 'bin', platform === 'win32' ? 'flutter.bat' : 'flutter')

const isSdk = (dir: string, platform: NodeJS.Platform, deps: EnvDeps): boolean => deps.isFile(flutterExecutable(dir, platform))

/** argv for spawn/execFile without a shell; on Windows `flutter.bat` goes through `cmd.exe /d /s /c` with verbatim quoting. */
export function flutterSpawn(sdk: string, args: string[], platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): SpawnSpec {
  const exe = flutterExecutable(sdk, platform)
  if (platform !== 'win32') return { file: exe, args: [...args] }
  const shim = cmdShim(exe, args, env)
  return { file: shim.file, args: shim.args, windowsVerbatimArguments: true }
}

/** SDK root as given, else the root of a picked `bin/flutter[.bat]` or `bin` folder. */
function normalizeSetting(setting: string, platform: NodeJS.Platform, deps: EnvDeps): string {
  const p = pathFor(platform)
  const given = p.normalize(setting.trim())
  // The SDK root itself is usually named `flutter` (C:\src\flutter): only strip it when it is not an SDK.
  if (isSdk(given, platform, deps)) return given
  let dir = given
  if (/^flutter(\.bat|\.exe)?$/i.test(p.basename(dir))) dir = p.dirname(dir)
  if (p.basename(dir).toLowerCase() === 'bin') dir = p.dirname(dir)
  return dir
}

function fvmCandidates(projectDir: string, version: string, opts: FlutterEnvOpts): string[] {
  const p = pathFor(opts.platform)
  const out = [p.join(projectDir, '.fvm', 'flutter_sdk'), p.join(projectDir, '.fvm', 'versions', version)]
  const cache = opts.env.FVM_CACHE_PATH ?? opts.env.FVM_HOME
  if (cache) out.push(p.join(cache, 'versions', version), p.join(cache, version))
  out.push(p.join(opts.home, 'fvm', 'versions', version))
  if (opts.platform === 'win32' && opts.env.LOCALAPPDATA) out.push(p.join(opts.env.LOCALAPPDATA, 'fvm', 'versions', version))
  return out
}

function onPath(opts: FlutterEnvOpts, deps: EnvDeps): string | null {
  const p = pathFor(opts.platform)
  const name = opts.platform === 'win32' ? 'flutter.bat' : 'flutter'
  const sep = opts.platform === 'win32' ? ';' : ':'
  const dirs = (opts.env.PATH ?? opts.env.Path ?? '').split(sep).filter((d) => d && p.isAbsolute(d))
  for (const dir of dirs) {
    const file = p.join(dir, name)
    if (!deps.isFile(file)) continue
    // Homebrew / FVM `default` put a symlink on PATH; the SDK is next to the real file.
    const sdk = p.dirname(p.dirname(deps.realpath(file)))
    if (isSdk(sdk, opts.platform, deps)) return sdk
  }
  return null
}

function osDefaults(opts: FlutterEnvOpts, deps: EnvDeps): string[] {
  const p = pathFor(opts.platform)
  if (opts.platform === 'win32') {
    const out = ['C:\\src\\flutter', p.join(opts.env.USERPROFILE ?? opts.home, 'flutter')]
    if (opts.env.LOCALAPPDATA) out.push(p.join(opts.env.LOCALAPPDATA, 'flutter'))
    return out
  }
  const out = [p.join(opts.home, 'development', 'flutter'), p.join(opts.home, 'flutter')]
  for (const cask of ['/opt/homebrew/Caskroom/flutter', '/usr/local/Caskroom/flutter']) {
    for (const v of deps.readdir(cask).sort().reverse()) out.push(p.join(cask, v, 'flutter'))
  }
  return out
}

/** Project FVM pin from `.fvmrc` / `.fvm/fvm_config.json`. */
export function projectFvmVersion(projectDir: string, platform: NodeJS.Platform, deps: EnvDeps = nodeEnvDeps): string | null {
  const p = pathFor(platform)
  for (const file of [p.join(projectDir, '.fvmrc'), p.join(projectDir, '.fvm', 'fvm_config.json')]) {
    const text = deps.readText(file)
    const v = text === null ? null : parseFvmConfig(text)
    if (v) return v
  }
  return null
}

/** Lookup order: setting → FVM pin → FLUTTER_ROOT → PATH → OS defaults. */
export function findFlutterSdk(projectDir: string, opts: FlutterEnvOpts, deps: EnvDeps = nodeEnvDeps): FlutterSdkLookup {
  const issues: EnvIssue[] = []
  const fvm = projectFvmVersion(projectDir, opts.platform, deps)
  const hit = (sdk: string, source: FlutterSdkSource): FlutterSdkLookup => ({ sdk, source, fvm, issues })
  if (opts.setting?.trim()) {
    const dir = normalizeSetting(opts.setting, opts.platform, deps)
    if (isSdk(dir, opts.platform, deps)) return hit(dir, 'setting')
    issues.push({ code: 'flutter-setting-invalid', detail: dir })
  }
  const fvmDirs = fvm ? fvmCandidates(projectDir, fvm, opts) : [pathFor(opts.platform).join(projectDir, '.fvm', 'flutter_sdk')]
  const fvmDir = fvmDirs.find((d) => isSdk(d, opts.platform, deps))
  if (fvmDir) return hit(fvmDir, 'fvm')
  if (fvm) issues.push({ code: 'fvm-version-missing', detail: fvm })
  const root = opts.env.FLUTTER_ROOT
  if (root && isSdk(root, opts.platform, deps)) return hit(root, 'FLUTTER_ROOT')
  const fromPath = onPath(opts, deps)
  if (fromPath) return hit(fromPath, 'path')
  const def = osDefaults(opts, deps).find((d) => isSdk(d, opts.platform, deps))
  if (def) return hit(def, 'default')
  issues.push({ code: 'flutter-missing' })
  return { sdk: null, source: null, fvm, issues }
}

export interface FlutterVersion {
  version: string | null
  dart: string | null
  channel: string | null
}

/** `flutter --version --machine`; tolerates banner text around the JSON (first run, upgrade notices). */
export function parseFlutterVersion(stdout: string): FlutterVersion | null {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const json = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? (v.trim().split(/\s+/)[0] ?? null) : null)
    const version = str(json.frameworkVersion)
    if (!version) return null
    return { version, dart: str(json.dartSdkVersion), channel: str(json.channel) }
  } catch {
    return null
  }
}

/** `.fvm/flutter_sdk` & co. are files the repo controls: running them is running repo code. */
export function sdkInsideProject(sdk: string, projectDir: string, opts: FlutterEnvOpts, deps: EnvDeps): boolean {
  const real = deps.realpath(sdk)
  return [projectDir, opts.repoRoot].some((root) => !!root && isWithin(deps.realpath(root), real, opts.platform))
}

/** Passive check (Run pane open): without `trusted`, an SDK inside the project/repo is reported, not executed. */
export async function flutterEnv(projectDir: string, opts: FlutterEnvOpts, deps: EnvDeps = nodeEnvDeps): Promise<FlutterEnv> {
  const found = findFlutterSdk(projectDir, opts, deps)
  const env: FlutterEnv = {
    kind: 'flutter',
    sdk: found.sdk,
    source: found.source,
    version: null,
    dart: null,
    channel: null,
    fvm: found.source === 'fvm',
    issues: [...found.issues],
  }
  if (!found.sdk) return env
  if (!opts.trusted && found.source !== 'setting' && sdkInsideProject(found.sdk, projectDir, opts, deps)) {
    env.issues.push({ code: 'fvm-local-unverified', detail: found.sdk })
    return env
  }
  let spec: SpawnSpec
  try {
    spec = flutterSpawn(found.sdk, ['--version', '--machine'], opts.platform, opts.env)
  } catch {
    env.issues.push({ code: 'flutter-version-failed', detail: found.sdk })
    return env
  }
  const res = await deps.exec(spec.file, spec.args, {
    timeout: opts.timeoutMs ?? VERSION_TIMEOUT,
    env: opts.env,
    ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  })
  const v = res.ok ? parseFlutterVersion(res.stdout) : null
  if (!v) {
    env.issues.push({ code: 'flutter-version-failed', detail: found.sdk })
    return env
  }
  return { ...env, ...v }
}
