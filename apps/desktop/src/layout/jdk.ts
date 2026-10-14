import path from 'node:path'
import { fsEnvDeps, MIN_JDK, parseJavaVersion, studioJbr, type EnvDeps } from '../run/android/env'
import type { JdkStatus } from './types'

export interface JdkLookup {
  setting: string | null
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}

const exe = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'java.exe' : 'java')

function pathCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const raw = env.PATH ?? env.Path ?? ''
  return raw
    .split(platform === 'win32' ? ';' : ':')
    .filter((d) => d && p.isAbsolute(d))
    .map((d) => p.dirname(d))
}

/** Run settings JDK → JAVA_HOME → Android Studio JBR → PATH; the first one ≥ 17 wins (system java is often 11). */
export async function findJdk(opts: JdkLookup, deps: Pick<EnvDeps, 'isFile' | 'exec'> = fsEnvDeps): Promise<JdkStatus & { java?: string }> {
  const p = opts.platform === 'win32' ? path.win32 : path.posix
  const homes = [opts.setting, opts.env.JAVA_HOME, studioJbr(opts.platform, opts.env), ...pathCandidates(opts.env, opts.platform)]
  const seen = new Set<string>()
  let old: string | null = null
  for (const raw of homes) {
    const home = raw?.trim()
    if (!home || !p.isAbsolute(home) || seen.has(home.toLowerCase())) continue
    seen.add(home.toLowerCase())
    const java = p.join(home, 'bin', exe(opts.platform))
    if (!(await deps.isFile(java))) continue
    const out = await deps.exec(java, ['-version'], 15_000)
    const version = out ? parseJavaVersion(`${out.stderr}\n${out.stdout}`) : null
    if (version === null) continue
    if (version >= MIN_JDK) return { ok: true, home, version, java }
    old ??= String(version)
  }
  return old ? { ok: false, code: 'jdk-old', detail: old } : { ok: false, code: 'jdk-missing' }
}
