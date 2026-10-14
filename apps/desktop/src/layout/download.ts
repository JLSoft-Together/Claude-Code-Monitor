import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import { get as httpsGet } from 'node:https'
import path from 'node:path'
import { extractZip, ZipError } from './zip'
import { LAYOUTLIB_VERSION, type BundleStatus } from './types'

export interface Artifact {
  artifact: 'layoutlib' | 'layoutlib-runtime' | 'layoutlib-resources'
  classifier?: 'win' | 'mac' | 'mac-arm'
  size: number
  sha256: string
}

// Pinned from apps/layout-daemon/README.md (Google Maven; sha1 cross-checked against Google's .sha1 files).
export const ARTIFACTS = {
  jar: { artifact: 'layoutlib', size: 60_286_750, sha256: '5dbdbd3e35abb8f8bab4c3019869642f515afd31c43d230ece0be082486c3ec8' },
  win: { artifact: 'layoutlib-runtime', classifier: 'win', size: 76_544_623, sha256: 'adadac21f5a9bfde4336d834ce0f9db83a478c65f27afd48751c470b3d708c6f' },
  mac: { artifact: 'layoutlib-runtime', classifier: 'mac', size: 80_275_609, sha256: '2b4462089c3976735cd79570e3ce35b4fe24d1c70112a8c75f422dac477ef732' },
  macArm: { artifact: 'layoutlib-runtime', classifier: 'mac-arm', size: 79_334_417, sha256: '2ca430114a7ec0c718b998ef12af915a724f7a2530dc3c382c616a2ca9076e38' },
  resources: { artifact: 'layoutlib-resources', size: 34_854_638, sha256: 'b4c4582e3680cbc8e0248223dc6ccf393bdedecd38cfccd03a33014b9238c559' },
} as const satisfies Record<string, Artifact>

const MAVEN = 'https://dl.google.com/android/maven2/com/android/tools/layoutlib'
const ALLOWED_HOST = 'dl.google.com'
const MAX_UNZIPPED = 600 * 1024 * 1024
const READY_MARKER = '.ccm-ready'
export const JAR_NAME = `layoutlib-${LAYOUTLIB_VERSION}.jar`

export function runtimeFor(platform: NodeJS.Platform, arch: string): Artifact | null {
  if (platform === 'win32') return ARTIFACTS.win
  if (platform === 'darwin') return arch === 'arm64' ? ARTIFACTS.macArm : ARTIFACTS.mac
  return null
}

export function artifactUrl(a: Artifact): string {
  const file = `${a.artifact}-${LAYOUTLIB_VERSION}${a.classifier ? `-${a.classifier}` : ''}.jar`
  return `${MAVEN}/${a.artifact}/${LAYOUTLIB_VERSION}/${file}`
}

/** Only https from Google Maven: the bytes become code on the daemon classpath. */
export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === ALLOWED_HOST && !u.username && !u.password && (u.port === '' || u.port === '443')
  } catch {
    return false
  }
}

export interface HttpBody {
  status: number
  length: number | null
  body: AsyncIterable<Buffer>
  abort: () => void
}

export type Fetcher = (url: string) => Promise<HttpBody>

/** No redirects are followed: Google Maven answers 200 directly and a redirect could leave the allowed host. */
export const httpsFetcher: Fetcher = (url) =>
  new Promise((resolve, reject) => {
    const req = httpsGet(url, { timeout: 30_000 }, (res) => {
      const len = Number(res.headers['content-length'])
      resolve({ status: res.statusCode ?? 0, length: Number.isFinite(len) ? len : null, body: res, abort: () => req.destroy() })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })

export class DownloadError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

/** Streams `a` into `file`, refusing anything that is not exactly the pinned size + sha256. */
export async function downloadArtifact(a: Artifact, file: string, fetcher: Fetcher, onBytes: (n: number) => void, url = artifactUrl(a)): Promise<void> {
  if (!isAllowedUrl(url)) throw new DownloadError('host-not-allowed')
  const res = await fetcher(url).catch(() => {
    throw new DownloadError('network')
  })
  if (res.status !== 200) {
    res.abort()
    throw new DownloadError(`http-${res.status}`)
  }
  if (res.length !== null && res.length !== a.size) {
    res.abort()
    throw new DownloadError('size-mismatch')
  }
  const hash = createHash('sha256')
  const out = createWriteStream(file)
  let got = 0
  try {
    for await (const chunk of res.body) {
      got += chunk.length
      if (got > a.size) {
        res.abort()
        throw new DownloadError('size-mismatch')
      }
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
      onBytes(chunk.length)
    }
  } catch (err) {
    out.destroy()
    await fs.rm(file, { force: true })
    throw err instanceof DownloadError ? err : new DownloadError('network')
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  if (got !== a.size) {
    await fs.rm(file, { force: true })
    throw new DownloadError('size-mismatch')
  }
  if (hash.digest('hex') !== a.sha256) {
    await fs.rm(file, { force: true })
    throw new DownloadError('sha256-mismatch')
  }
}

export interface BundleDeps {
  /** `<dataDir>/layoutlib`; the bundle lands in `<base>/<version>/`. */
  base: string
  platform: NodeJS.Platform
  arch: string
  fetcher?: Fetcher
  /** Dev: an already staged folder (apps/layout-daemon/build/layoutlib-dist) used instead of downloading. */
  overrideDir?: string | null
  onStatus?: (status: BundleStatus) => void
}

export class LayoutlibBundle {
  private downloading: Promise<void> | null = null
  private pct = 0
  private lastError: string | null = null

  constructor(private readonly deps: BundleDeps) {}

  get dir(): string {
    const o = this.deps.overrideDir
    if (o && existsSync(path.join(o, JAR_NAME))) return o
    return path.join(this.deps.base, LAYOUTLIB_VERSION)
  }

  /** Total compressed bytes for this OS (for the consent dialog). */
  get downloadBytes(): number {
    const runtime = runtimeFor(this.deps.platform, this.deps.arch)
    return ARTIFACTS.jar.size + ARTIFACTS.resources.size + (runtime?.size ?? 0)
  }

  isReady(): boolean {
    const dir = this.dir
    if (dir !== path.join(this.deps.base, LAYOUTLIB_VERSION)) return true
    return existsSync(path.join(dir, READY_MARKER)) && existsSync(path.join(dir, JAR_NAME))
  }

  status(): BundleStatus {
    if (this.downloading) return { state: 'downloading', pct: this.pct }
    if (this.isReady()) return { state: 'ready', dir: this.dir }
    if (this.lastError) return { state: 'error', code: this.lastError }
    return { state: 'missing' }
  }

  download(): Promise<BundleStatus> {
    if (this.isReady()) return Promise.resolve(this.status())
    this.downloading ??= this.run().finally(() => {
      this.downloading = null
      this.deps.onStatus?.(this.status())
    })
    return this.downloading.then(() => this.status())
  }

  private emit(pct: number): void {
    const next = Math.min(100, Math.floor(pct))
    if (next === this.pct) return
    this.pct = next
    this.deps.onStatus?.({ state: 'downloading', pct: next })
  }

  private async run(): Promise<void> {
    const { base, platform, arch } = this.deps
    const runtime = runtimeFor(platform, arch)
    if (!runtime) {
      this.lastError = 'unsupported-os'
      return
    }
    this.lastError = null
    this.pct = 0
    this.deps.onStatus?.({ state: 'downloading', pct: 0 })
    const fetcher = this.deps.fetcher ?? httpsFetcher
    const tmp = path.join(base, `${LAYOUTLIB_VERSION}.partial-${randomBytes(4).toString('hex')}`)
    try {
      await fs.mkdir(base, { recursive: true })
      await this.sweepPartials()
      await fs.mkdir(tmp, { recursive: true })
      const total = this.downloadBytes
      let done = 0
      const onBytes = (n: number): void => {
        done += n
        this.emit((done / total) * 85)
      }
      const runtimeJar = path.join(tmp, 'runtime.download.jar')
      const resourcesJar = path.join(tmp, 'resources.download.jar')
      await downloadArtifact(ARTIFACTS.jar, path.join(tmp, JAR_NAME), fetcher, onBytes)
      await downloadArtifact(runtime, runtimeJar, fetcher, onBytes)
      await downloadArtifact(ARTIFACTS.resources, resourcesJar, fetcher, onBytes)
      await extractZip(runtimeJar, path.join(tmp, 'runtime'), { maxTotal: MAX_UNZIPPED })
      this.emit(92)
      await extractZip(resourcesJar, path.join(tmp, 'resources'), { maxTotal: MAX_UNZIPPED })
      await fs.rm(runtimeJar, { force: true })
      await fs.rm(resourcesJar, { force: true })
      await fs.writeFile(path.join(tmp, READY_MARKER), `${LAYOUTLIB_VERSION}\n`)
      const dest = path.join(base, LAYOUTLIB_VERSION)
      await fs.rm(dest, { recursive: true, force: true })
      await fs.rename(tmp, dest)
      this.emit(100)
    } catch (err) {
      this.lastError = err instanceof DownloadError || err instanceof ZipError ? err.code : 'io'
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async sweepPartials(): Promise<void> {
    const names = await fs.readdir(this.deps.base).catch(() => [] as string[])
    for (const n of names) if (n.startsWith(`${LAYOUTLIB_VERSION}.partial-`)) await fs.rm(path.join(this.deps.base, n), { recursive: true, force: true }).catch(() => undefined)
  }
}
