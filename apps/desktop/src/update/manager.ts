import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { UpdateError, UpdateInstallKind, UpdateRelease, UpdateState } from '@ccm/shared'
import { downloadAsset } from './download'
import { fetchLatest, type FetchFn } from './github'
import type { Prepared } from './install'
import { pickAsset, type FeedAsset } from './pick'
import { compareVersions, isNewer } from './semver'

export const FIRST_CHECK_MS = 30_000
export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000
export const UPDATE_SETTINGS_FILE = 'update.json'
const PENDING_FILE = 'pending.json'

export interface UpdateDeps {
  current: string
  kind: UpdateInstallKind
  /** Asset shape to download: `kind`, or for a dev build against a test feed the OS default. */
  assetKind: UpdateInstallKind
  canDownload: boolean
  arch: string
  dataDir: string
  feed: string
  allowLocal: boolean
  fetch: FetchFn
  broadcast: (state: UpdateState) => void
  prepare: (file: string) => Promise<Prepared>
  /** Asks about open panes / unsaved files, then quits and runs `launch` on the way out; false = cancelled. */
  restart: (launch: () => void, version: string) => Promise<boolean>
  openUrl: (url: string) => void
  reveal: (file: string) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

interface Saved {
  autoCheck: boolean
  skipped: string | null
}

export class UpdateManager {
  private s: UpdateState
  private asset: FeedAsset | null = null
  private file: string | null = null
  private abort: AbortController | null = null
  private timer: unknown = null
  private checking: Promise<UpdateState> | null = null
  private readonly dir: string
  private readonly settingsFile: string

  constructor(private readonly deps: UpdateDeps) {
    this.dir = path.join(deps.dataDir, 'updates')
    this.settingsFile = path.join(deps.dataDir, UPDATE_SETTINGS_FILE)
    const saved = this.readSaved()
    this.s = {
      current: deps.current,
      kind: deps.kind,
      canDownload: deps.canDownload,
      phase: 'idle',
      release: null,
      checkedAt: null,
      progress: null,
      error: null,
      autoCheck: saved.autoCheck,
      skipped: saved.skipped,
    }
  }

  state(): UpdateState {
    return { ...this.s }
  }

  /** Leftovers of a finished update are removed; a newer version still waiting in pending.json means the installer did not finish. */
  start(): void {
    const pending = this.readPending()
    if (pending && isNewer(pending, this.deps.current)) {
      this.set({ phase: 'error', error: 'incomplete' })
      this.file = this.findDownloaded()
    } else {
      try {
        rmSync(this.dir, { recursive: true, force: true })
      } catch {
        // A locked leftover is retried on the next start.
      }
    }
    this.schedule(FIRST_CHECK_MS)
  }

  dispose(): void {
    this.unschedule()
    this.abort?.abort()
  }

  setAutoCheck(on: boolean): UpdateState {
    this.set({ autoCheck: on })
    this.writeSaved()
    if (on) this.schedule(this.s.checkedAt ? Math.max(FIRST_CHECK_MS, this.s.checkedAt + CHECK_EVERY_MS - Date.now()) : FIRST_CHECK_MS)
    else this.unschedule()
    return this.state()
  }

  skip(version: unknown): UpdateState {
    if (typeof version === 'string' && version === this.s.release?.version) {
      this.set({ skipped: version })
      this.writeSaved()
    }
    return this.state()
  }

  check(): Promise<UpdateState> {
    if (this.busy()) return Promise.resolve(this.state())
    this.checking ??= this.runCheck().finally(() => (this.checking = null))
    return this.checking
  }

  async download(): Promise<UpdateState> {
    if (!this.s.canDownload || !this.asset || this.s.phase === 'downloading' || this.s.phase === 'ready' || this.s.phase === 'installing') return this.state()
    const asset = this.asset
    const abort = new AbortController()
    this.abort = abort
    this.set({ phase: 'downloading', error: null, progress: { received: 0, total: asset.size, bps: 0 } })
    const res = await downloadAsset({
      asset,
      dir: this.dir,
      fetch: this.deps.fetch,
      allowLocal: this.deps.allowLocal,
      signal: abort.signal,
      onProgress: (progress) => {
        if (this.abort === abort) this.set({ progress })
      },
    })
    if (this.abort !== abort) return this.state()
    this.abort = null
    if (res.ok) {
      this.file = res.file
      this.set({ phase: 'ready', progress: null })
    } else if (res.error === 'cancelled') this.set({ phase: 'available', progress: null })
    else this.set({ phase: 'error', progress: null, error: res.error })
    return this.state()
  }

  cancel(): UpdateState {
    if (this.s.phase !== 'downloading' || !this.abort) return this.state()
    this.abort.abort()
    this.abort = null
    this.set({ phase: 'available', progress: null })
    return this.state()
  }

  /** Never runs a file that is not the verified download of the release in hand. */
  async install(): Promise<UpdateState> {
    const file = this.file
    if (this.s.phase !== 'ready' || !file || !existsSync(file) || !this.s.release) return this.state()
    if (this.deps.kind === 'dev' || this.deps.kind === 'unsupported') {
      this.deps.reveal(file)
      return this.state()
    }
    this.set({ phase: 'installing', error: null })
    const prepared = await this.deps.prepare(file)
    if (!prepared.ok) {
      if (prepared.error === 'mac-readonly') this.deps.openUrl(file)
      this.set({ phase: prepared.error === 'mac-readonly' ? 'ready' : 'error', error: prepared.error })
      return this.state()
    }
    const version = this.s.release.version
    const launch = (): void => {
      try {
        writeFileSync(path.join(this.dir, PENDING_FILE), JSON.stringify({ version }))
      } catch {
        // Only the "did not finish" notice depends on it.
      }
      prepared.launch()
    }
    const ok = await this.deps.restart(launch, version).catch(() => false)
    if (!ok) this.set({ phase: 'ready' })
    return this.state()
  }

  openPage(): void {
    if (this.s.release) this.deps.openUrl(this.s.release.url)
  }

  revealFile(): void {
    if (this.file && existsSync(this.file)) this.deps.reveal(this.file)
  }

  private busy(): boolean {
    return this.s.phase === 'downloading' || this.s.phase === 'ready' || this.s.phase === 'installing'
  }

  private async runCheck(): Promise<UpdateState> {
    const incomplete = this.s.error === 'incomplete'
    this.set({ phase: 'checking', error: null })
    const res = await fetchLatest(this.deps.feed, this.deps.fetch, this.deps.allowLocal)
    this.s.checkedAt = Date.now()
    if (this.s.autoCheck) this.schedule(CHECK_EVERY_MS)
    if (!res.ok) {
      this.set({ phase: 'error', error: incomplete ? 'incomplete' : res.error })
      return this.state()
    }
    const rel = res.release
    if (!rel || !isNewer(rel.version, this.deps.current)) {
      this.asset = null
      this.set({ phase: 'none', release: null })
      return this.state()
    }
    this.asset = pickAsset(rel.assets, rel.version, this.deps.assetKind, this.deps.arch)
    const release: UpdateRelease = {
      version: rel.version,
      name: rel.name,
      date: rel.date,
      notes: rel.notes,
      url: rel.url,
      asset: this.asset ? { name: this.asset.name, size: this.asset.size } : null,
    }
    const error: UpdateError | null = !this.s.canDownload ? null : !this.asset ? 'no-asset' : !this.asset.sha256 ? 'no-digest' : null
    // A newer release replaces the skip only when it is not the skipped one.
    if (this.s.skipped && compareVersions(rel.version, this.s.skipped) > 0) this.set({ skipped: null })
    this.set({ phase: 'available', release, error: incomplete ? 'incomplete' : error })
    return this.state()
  }

  private schedule(ms: number): void {
    this.unschedule()
    if (!this.s.autoCheck) return
    const set = this.deps.setTimer ?? ((fn, delay) => setTimeout(fn, delay))
    this.timer = set(() => {
      this.timer = null
      void this.check()
    }, ms)
  }

  private unschedule(): void {
    if (this.timer === null) return
    const clear = this.deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout))
    clear(this.timer)
    this.timer = null
  }

  private set(patch: Partial<UpdateState>): void {
    this.s = { ...this.s, ...patch }
    this.deps.broadcast(this.state())
  }

  private readSaved(): Saved {
    try {
      const raw = JSON.parse(readFileSync(this.settingsFile, 'utf8')) as Partial<Saved>
      return { autoCheck: raw.autoCheck !== false, skipped: typeof raw.skipped === 'string' ? raw.skipped : null }
    } catch {
      return { autoCheck: true, skipped: null }
    }
  }

  private writeSaved(): void {
    try {
      writeFileSync(this.settingsFile, JSON.stringify({ autoCheck: this.s.autoCheck, skipped: this.s.skipped }))
    } catch {
      // Settings stay for this run.
    }
  }

  private readPending(): string | null {
    try {
      const raw = JSON.parse(readFileSync(path.join(this.dir, PENDING_FILE), 'utf8')) as { version?: unknown }
      return typeof raw.version === 'string' ? raw.version : null
    } catch {
      return null
    }
  }

  private findDownloaded(): string | null {
    try {
      const name = readdirSync(this.dir).find((n) => !n.endsWith('.part') && n !== PENDING_FILE)
      return name ? path.join(this.dir, name) : null
    } catch {
      return null
    }
  }
}
