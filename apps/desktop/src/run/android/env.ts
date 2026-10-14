import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AndroidEnv, EnvIssue } from '@ccm/shared'
import { isWithin } from '../../preview/paths'
import { cmdShim, quoteCmdArg } from '../resolve'

export interface EnvDeps {
  isFile(file: string): Promise<boolean>
  readText(file: string): Promise<string | null>
  /** File mode bits, null when missing. */
  mode(file: string): Promise<number | null>
  /** Never through a shell; null when it could not start or timed out. */
  exec(file: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string } | null>
  realpath?(file: string): Promise<string>
}

export interface AndroidEnvOpts {
  sdkSetting?: string | null
  jdkSetting?: string | null
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  /** Explicit Run: may execute tools found inside the project. Passive env checks pass false. */
  trusted?: boolean
  /** Repo root the project sits in (passive check boundary besides the Gradle root). */
  repoRoot?: string
}

const MAX_FILE = 256 * 1024
const JAVA_TIMEOUT = 15_000
export const MIN_JDK = 17

export const fsEnvDeps: EnvDeps = {
  async isFile(file) {
    return !!(await fs.stat(file).catch(() => null))?.isFile()
  },
  async readText(file) {
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > MAX_FILE) return null
      return await fs.readFile(file, 'utf8')
    } catch {
      return null
    }
  },
  async realpath(file) {
    return fs.realpath(file).catch(() => file)
  },
  async mode(file) {
    return (await fs.stat(file).catch(() => null))?.mode ?? null
  },
  exec(file, args, timeoutMs) {
    return new Promise((resolve) => {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true, shell: false, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
        // `java -version` exits 0; a non-zero exit with output (old JREs) is still parseable.
        if (err && !stdout && !stderr) resolve(null)
        else resolve({ stdout: String(stdout), stderr: String(stderr) })
      })
    })
  },
}

const pathOf = (platform: NodeJS.Platform): path.PlatformPath => (platform === 'win32' ? path.win32 : path.posix)
const exe = (name: string, platform: NodeJS.Platform): string => (platform === 'win32' ? `${name}.exe` : name)

/** Java `.properties` value unescape (`C\:\\Users` → `C:\Users`). */
export function readProperty(text: string, key: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimStart()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const m = /^((?:\\.|[^:=\s\\])+)\s*[:=]?\s*(.*)$/.exec(line)
    if (!m) continue
    const unescape = (s: string): string => s.replace(/\\(.)/g, (_x, c: string) => ({ t: '\t', n: '\n', r: '\r', f: '\f' })[c] ?? c)
    if (unescape(m[1]!) === key) return unescape(m[2]!.trimEnd())
  }
  return null
}

/** Major version from `java -version` output: `"17.0.9"` → 17, `"1.8.0_381"` → 8, `"21"` → 21. */
export function parseJavaVersion(output: string): number | null {
  const m = /version\s+"([^"]+)"/.exec(output)
  if (!m) return null
  const parts = m[1]!.split(/[.+_-]/)
  const major = parts[0] === '1' ? Number(parts[1]) : Number(parts[0])
  return Number.isInteger(major) && major > 0 ? major : null
}

async function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, deps: EnvDeps): Promise<string | null> {
  const p = pathOf(platform)
  const raw = env.PATH ?? env.Path ?? ''
  for (const dir of raw.split(platform === 'win32' ? ';' : ':')) {
    // Relative entries would resolve against the project cwd.
    if (!dir || !p.isAbsolute(dir)) continue
    const file = p.join(dir, name)
    if (await deps.isFile(file)) return file
  }
  return null
}

export function defaultSdkDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string | null {
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'Android', 'Sdk')
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Android', 'sdk')
  return null
}

export function studioJbr(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  if (platform === 'win32') return path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'jbr')
  if (platform === 'darwin') return '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
  return null
}

async function sdkCandidates(root: string, opts: AndroidEnvOpts, deps: EnvDeps): Promise<string[]> {
  const p = pathOf(opts.platform)
  const out: (string | null | undefined)[] = [opts.sdkSetting, opts.env.ANDROID_HOME, opts.env.ANDROID_SDK_ROOT]
  const props = await deps.readText(p.join(root, 'local.properties'))
  const sdkDir = props ? readProperty(props, 'sdk.dir') : null
  if (sdkDir) out.push(p.resolve(root, sdkDir))
  out.push(defaultSdkDir(opts.env, opts.platform, opts.home))
  return out.filter((d): d is string => !!d && !!d.trim()).map((d) => d.trim())
}

/** A repo-controlled binary (JAVA_HOME / PATH pointing into the checkout) is never run just to show the env. */
async function insideProject(file: string, gradleRoot: string, opts: AndroidEnvOpts, deps: EnvDeps): Promise<boolean> {
  const real = deps.realpath ?? (async (f: string) => f)
  const target = await real(file)
  for (const root of [gradleRoot, opts.repoRoot]) if (root && isWithin(await real(root), target, opts.platform)) return true
  return false
}

export function gradlewFile(root: string, platform: NodeJS.Platform): string {
  return pathOf(platform).join(root, platform === 'win32' ? 'gradlew.bat' : 'gradlew')
}

export async function androidEnv(gradleRoot: string, opts: AndroidEnvOpts, deps: EnvDeps = fsEnvDeps): Promise<AndroidEnv> {
  const { platform, env } = opts
  const p = pathOf(platform)
  const issues: EnvIssue[] = []

  let sdk: string | null = null
  for (const dir of await sdkCandidates(gradleRoot, opts, deps)) {
    if (await deps.isFile(p.join(dir, 'platform-tools', exe('adb', platform)))) {
      sdk = dir
      break
    }
  }
  let adb: string | null = null
  let emulator: string | null = null
  if (sdk) {
    adb = p.join(sdk, 'platform-tools', exe('adb', platform))
    const emu = p.join(sdk, 'emulator', exe('emulator', platform))
    if (await deps.isFile(emu)) emulator = emu
  } else {
    issues.push({ code: 'sdk-missing' })
    adb = await findOnPath(exe('adb', platform), env, platform, deps)
  }

  let jdk: string | null = null
  let java: string | null = null
  for (const dir of [opts.jdkSetting, env.JAVA_HOME, studioJbr(platform, env)]) {
    if (!dir?.trim()) continue
    const file = p.join(dir.trim(), 'bin', exe('java', platform))
    if (await deps.isFile(file)) {
      jdk = dir.trim()
      java = file
      break
    }
  }
  if (!java) {
    java = await findOnPath(exe('java', platform), env, platform, deps)
    if (java) jdk = p.dirname(p.dirname(java))
  }
  let jdkVersion: number | null = null
  if (java && !opts.trusted && (await insideProject(java, gradleRoot, opts, deps))) {
    issues.push({ code: 'jdk-local-unverified', detail: jdk ?? java })
  } else if (java) {
    const out = await deps.exec(java, ['-version'], JAVA_TIMEOUT)
    jdkVersion = out ? parseJavaVersion(`${out.stderr}\n${out.stdout}`) : null
    if (jdkVersion !== null && jdkVersion < MIN_JDK) issues.push({ code: 'jdk-old', detail: String(jdkVersion) })
  } else issues.push({ code: 'jdk-missing' })

  const wrapper = gradlewFile(gradleRoot, platform)
  const gradlew = await deps.isFile(wrapper)
  if (!gradlew) issues.push({ code: 'gradlew-missing' })
  else if (platform !== 'win32') {
    const mode = await deps.mode(wrapper)
    if (mode !== null && (mode & 0o111) === 0) issues.push({ code: 'gradlew-not-executable' })
  }

  return { kind: 'android', sdk, adb, emulator, jdk, jdkVersion, gradlew, issues }
}

export interface GradlewSpawn {
  file: string
  args: string[]
  /** Pass as `windowsVerbatimArguments`: the cmd.exe line below is already quoted. */
  verbatim: boolean
}

export { quoteCmdArg }

/** gradlew argv for `spawn(file, args, { shell: false })`; Node refuses to spawn a .bat directly on Windows. */
export function gradlewSpawn(root: string, args: readonly string[], platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): GradlewSpawn {
  const wrapper = gradlewFile(root, platform)
  if (platform !== 'win32') return { file: wrapper, args: [...args], verbatim: false }
  const shim = cmdShim(wrapper, args, env)
  return { file: shim.file, args: shim.args, verbatim: true }
}
