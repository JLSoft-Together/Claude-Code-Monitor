import path from 'node:path'
import { compareLibVersions } from '@ccm/shared'
import { findJdk } from '../layout/jdk'
import { defaultSdkDir, fsEnvDeps, type EnvDeps } from '../run/android/env'
import { isDebugSubject, parseApksigner, parseKeytool } from './rules'

export interface SignToolsOpts {
  jdkSetting: string | null
  sdkSetting: string | null
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
}

export interface SignTools {
  java: string | null
  keytool: string | null
  /** `build-tools/<newest>/lib/apksigner.jar`: run through `java -jar` since `apksigner.bat` needs a shell on Windows. */
  apksignerJar: string | null
}

const SIGN_TIMEOUT = 60_000

export async function findSignTools(opts: SignToolsOpts, deps: EnvDeps = fsEnvDeps): Promise<SignTools> {
  const p = opts.platform === 'win32' ? path.win32 : path.posix
  const jdk = await findJdk({ setting: opts.jdkSetting, env: opts.env, platform: opts.platform }, deps)
  const java = jdk.ok ? (jdk.java ?? null) : null
  const keytool = jdk.ok ? p.join(jdk.home, 'bin', opts.platform === 'win32' ? 'keytool.exe' : 'keytool') : null
  let apksignerJar: string | null = null
  const sdks = [opts.sdkSetting, opts.env.ANDROID_HOME, opts.env.ANDROID_SDK_ROOT, defaultSdkDir(opts.env, opts.platform, opts.home)]
  for (const sdk of sdks) {
    if (!sdk?.trim() || !p.isAbsolute(sdk.trim()) || apksignerJar) continue
    const bt = p.join(sdk.trim(), 'build-tools')
    const versions = ((await deps.listDirs?.(bt)) ?? []).filter((v) => /^\d[\w.-]*$/.test(v)).sort((a, b) => compareLibVersions(b, a))
    for (const v of versions) {
      const jar = p.join(bt, v, 'lib', 'apksigner.jar')
      if (await deps.isFile(jar)) {
        apksignerJar = jar
        break
      }
    }
  }
  return { java, keytool: keytool && (await deps.isFile(keytool)) ? keytool : null, apksignerJar }
}

export type SignOutcome = { ok: true; sha256: string; subject: string | null; debugKey: boolean } | { ok: false; error: 'no-jdk' | 'no-apksigner' | 'failed' | 'unsigned' }

/** APK: `apksigner verify --print-certs` (checks v2/v3 schemes); AAB: `keytool -printcert -jarfile` (bundles are jar-signed). */
export async function readSigner(file: string, tools: SignTools, deps: Pick<EnvDeps, 'exec'> = fsEnvDeps): Promise<SignOutcome> {
  const aab = /\.aab$/i.test(file)
  if (aab ? !tools.keytool : !tools.java) return { ok: false, error: 'no-jdk' }
  if (!aab && !tools.apksignerJar) return { ok: false, error: 'no-apksigner' }
  const res = aab
    ? await deps.exec(tools.keytool!, ['-J-Duser.language=en', '-printcert', '-jarfile', file], SIGN_TIMEOUT)
    : await deps.exec(tools.java!, ['-jar', tools.apksignerJar!, 'verify', '--print-certs', file], SIGN_TIMEOUT)
  if (!res) return { ok: false, error: 'failed' }
  const out = `${res.stdout}\n${res.stderr}`
  const parsed = aab ? parseKeytool(out) : parseApksigner(out)
  if (!parsed) return { ok: false, error: /not a signed jar|DOES NOT VERIFY|No JAR signatures|unsigned/i.test(out) ? 'unsigned' : 'failed' }
  return { ok: true, ...parsed, debugKey: isDebugSubject(parsed.subject) }
}
