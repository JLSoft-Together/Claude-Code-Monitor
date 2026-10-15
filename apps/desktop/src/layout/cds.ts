import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { JAR_NAME } from './download'
import { LAYOUTLIB_VERSION } from './types'

export interface CdsFs {
  readFile(file: string): Promise<string>
  stat(file: string): Promise<{ size: number; mtimeMs: number }>
  readdir(dir: string): Promise<string[]>
  mkdir(dir: string): Promise<void>
  rm(file: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  writeFile(file: string, text: string): Promise<void>
}

export const nodeCdsFs: CdsFs = {
  readFile: (file) => fsp.readFile(file, 'utf8'),
  stat: (file) => fsp.stat(file),
  readdir: (dir) => fsp.readdir(dir),
  mkdir: async (dir) => void (await fsp.mkdir(dir, { recursive: true })),
  // The JVM writes archives read-only; Windows refuses to unlink those.
  rm: async (file) => {
    await fsp.chmod(file, 0o666).catch(() => undefined)
    await fsp.rm(file, { force: true })
  },
  rename: (from, to) => fsp.rename(from, to),
  writeFile: (file, text) => fsp.writeFile(file, text),
}

export interface CdsInput {
  jdkHome: string
  cacheDir: string
  daemonJar: string
  layoutlibDir: string
  platform: NodeJS.Platform
}

/** `use` = start from the archive; `record` = the JVM writes its class list, later `dumpArgs` builds the archive from a snapshot of it. */
export type CdsPlan =
  | { mode: 'use'; jvmArgs: string[] }
  | { mode: 'record'; jvmArgs: string[]; classList: string; snapshot: string; archive: string; tmp: string; failMarker: string; dumpArgs: string[] }

const MIN_CLASSES = 1000
const MIN_ARCHIVE_BYTES = 1_000_000
const OWN = /^daemon-.+\.(jsa|classlist|tmp|nocds)$/
// JVM warnings (a stale archive, an unreadable class list) must not reach stdout: it is the RPC stream.
const LOG_TO_STDERR = ['-Xlog:disable', '-Xlog:all=warning:stderr']

/** `JAVA_VERSION="21.0.10"` from `<jdk>/release`. */
export function parseJdkRelease(text: string): string | null {
  const m = /^JAVA_VERSION="([^"]+)"/m.exec(text)
  return m?.[1]?.trim() || null
}

export function cdsKey(jdkVersion: string, jar: { size: number; mtimeMs: number }, daemonJar: string, layoutlibDir: string): string {
  const safe = jdkVersion.replace(/[^0-9A-Za-z.]+/g, '_').slice(0, 40)
  const hash = createHash('sha256').update(`${jar.size}:${Math.round(jar.mtimeMs)}:${daemonJar}:${layoutlibDir}`).digest('hex').slice(0, 12)
  return `daemon-${safe}-${LAYOUTLIB_VERSION}-${hash}`
}

/**
 * Static AppCDS (works on JDKs without a base archive, e.g. the Android Studio JBR, where AutoCreateSharedArchive
 * is refused). Key = JDK build + layoutlib + daemon jar size/mtime; files of any other key are deleted.
 */
export async function planCds(opts: CdsInput, fs: CdsFs = nodeCdsFs): Promise<CdsPlan | null> {
  const release = await fs.readFile(path.join(opts.jdkHome, 'release')).catch(() => null)
  const version = release ? parseJdkRelease(release) : null
  const jar = await fs.stat(opts.daemonJar).catch(() => null)
  if (!version || !jar) return null
  const key = cdsKey(version, jar, opts.daemonJar, opts.layoutlibDir)
  const file = (ext: string): string => path.join(opts.cacheDir, `${key}.${ext}`)
  let names: string[]
  try {
    await fs.mkdir(opts.cacheDir)
    names = await fs.readdir(opts.cacheDir)
  } catch {
    return null
  }
  for (const f of names) if (OWN.test(f) && !f.startsWith(`${key}.`)) await fs.rm(path.join(opts.cacheDir, f)).catch(() => undefined)
  if (names.includes(`${key}.nocds`)) return null
  const archive = names.includes(`${key}.jsa`) ? await fs.stat(file('jsa')).catch(() => null) : null
  if (archive && archive.size < MIN_ARCHIVE_BYTES) await fs.rm(file('jsa')).catch(() => undefined)
  else if (archive) return { mode: 'use', jvmArgs: [`-XX:SharedArchiveFile=${file('jsa')}`, '-Xshare:auto', ...LOG_TO_STDERR] }
  const sep = opts.platform === 'win32' ? ';' : ':'
  return {
    mode: 'record',
    jvmArgs: [`-XX:DumpLoadedClassList=${file('classlist')}`, ...LOG_TO_STDERR],
    classList: file('classlist'),
    snapshot: file('snap.classlist'),
    archive: file('jsa'),
    tmp: file('tmp'),
    failMarker: file('nocds'),
    dumpArgs: ['-Xshare:dump', `-XX:SharedClassListFile=${file('snap.classlist')}`, `-XX:SharedArchiveFile=${file('tmp')}`, ...LOG_TO_STDERR, '-cp', `${opts.daemonJar}${sep}${path.join(opts.layoutlibDir, JAR_NAME)}`],
  }
}

/** The JVM is still appending: copy up to the last full line. false = too few classes recorded yet. */
export async function snapshotClassList(plan: Extract<CdsPlan, { mode: 'record' }>, fs: CdsFs = nodeCdsFs): Promise<boolean> {
  const text = await fs.readFile(plan.classList).catch(() => '')
  const end = text.lastIndexOf('\n')
  if (end < 0 || text.slice(0, end).split('\n').length < MIN_CLASSES) return false
  await fs.writeFile(plan.snapshot, text.slice(0, end + 1))
  return true
}

/** After a successful dump: `.tmp` → `.jsa`; a failed one leaves a marker so it is not retried for this key. */
export async function finishDump(plan: Extract<CdsPlan, { mode: 'record' }>, ok: boolean, fs: CdsFs = nodeCdsFs): Promise<boolean> {
  const tmp = plan.tmp
  try {
    if (ok && (await fs.stat(tmp)).size > 0) {
      await fs.rename(tmp, plan.archive)
      await fs.rm(plan.snapshot).catch(() => undefined)
      return true
    }
  } catch {
    // fall through to the failure marker
  }
  await fs.rm(tmp).catch(() => undefined)
  await fs.rm(plan.snapshot).catch(() => undefined)
  await fs.writeFile(plan.failMarker, '').catch(() => undefined)
  return false
}
