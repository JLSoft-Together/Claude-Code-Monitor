import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CaptureConfig, CaptureProblem, CaptureStatus } from '@ccm/shared'
import { fileComplete } from '../devices/recorder'
import { isInside, isOrreryFile, parseConfig, pickExpired, REC_FILE, REC_SUB, shotName, SHOT_SUB, SWEEP_EVERY_MS, type CapturedFile } from './files'

export interface CaptureFolderDeps {
  /** `<DATA_DIR>/capture.json`. */
  file: string
  /** `os.tmpdir()`: recordings land in `<tmp>/orrery-rec` without a capture folder. */
  tmpRoot: string
  videos: () => string
  /** Folder gone (USB / network drive): told once per folder and run. */
  onMissing?: (dir: string) => void
  /** Recording files still behind a token: never swept. */
  held?: () => string[]
  now?: () => number
}

export const TEMP_REC_DIR = 'orrery-rec'

/** Owner-picked folder for recordings and screenshots handed to agents (v76 R4). */
export class CaptureFolder {
  private cfg: CaptureConfig
  private warned = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: CaptureFolderDeps) {
    let raw: unknown = null
    try {
      raw = JSON.parse(readFileSync(deps.file, 'utf8'))
    } catch {
      raw = null
    }
    this.cfg = parseConfig(raw)
  }

  config(): CaptureConfig {
    return { ...this.cfg }
  }

  private problem(dir: string): CaptureProblem | null {
    try {
      if (!existsSync(path.parse(dir).root) || !existsSync(dir) || !statSync(dir).isDirectory()) return 'missing'
      accessSync(dir, constants.W_OK)
      return null
    } catch {
      return 'not-writable'
    }
  }

  status(): CaptureStatus {
    const dir = this.cfg.dir
    if (!dir) return { config: this.config(), active: null, problem: null }
    const problem = this.problem(dir)
    if (problem === 'missing' && !this.warned.has(dir)) {
      this.warned.add(dir)
      this.deps.onMissing?.(dir)
    }
    if (!problem) this.warned.delete(dir)
    return { config: this.config(), active: problem ? null : dir, problem }
  }

  active(): string | null {
    return this.status().active
  }

  set(patch: Partial<CaptureConfig>): CaptureStatus {
    this.cfg = { ...this.cfg, ...patch }
    try {
      writeFileSync(this.deps.file, JSON.stringify(this.cfg))
    } catch {
      // Kept for this run only.
    }
    const s = this.status()
    if (s.active) void this.sweep()
    return s
  }

  recordingsDir(): string {
    const dir = this.active()
    return dir ? path.join(dir, REC_SUB) : path.join(this.deps.tmpRoot, TEMP_REC_DIR)
  }

  /** A recording kept under a token in the capture folder survives its token. */
  keeps(file: string): boolean {
    const dir = this.cfg.dir
    return !!dir && isInside(path.join(dir, REC_SUB), file)
  }

  saveDir(): string {
    const dir = this.active()
    if (!dir) return this.deps.videos()
    const rec = path.join(dir, REC_SUB)
    try {
      mkdirSync(rec, { recursive: true })
    } catch {
      return this.deps.videos()
    }
    return rec
  }

  wantsFiles(): boolean {
    return this.cfg.asFile && this.active() !== null
  }

  async writeShot(png: Buffer, device: string, frame: number | null): Promise<string | null> {
    const dir = this.active()
    if (!dir) return null
    const shots = path.join(dir, SHOT_SUB)
    mkdirSync(shots, { recursive: true })
    const at = new Date((this.deps.now ?? Date.now)())
    for (let dup = 1; dup <= 50; dup++) {
      const file = path.join(shots, shotName(device, at, frame, dup))
      try {
        await fs.writeFile(file, png, { flag: 'wx' })
        return file
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return null
      }
    }
    return null
  }

  private async list(dir: string, sub: string): Promise<CapturedFile[]> {
    const folder = path.join(dir, sub)
    const names = await fs.readdir(folder).catch(() => [] as string[])
    const out: CapturedFile[] = []
    for (const name of names) {
      if (!isOrreryFile(sub, name)) continue
      const file = path.join(folder, name)
      const st = await fs.stat(file).catch(() => null)
      if (st?.isFile()) out.push({ path: file, size: st.size, mtimeMs: st.mtimeMs })
    }
    return out
  }

  /** Retention: only Orrery-named files in `recordings/` and `shots/`; returns how many went. */
  async sweep(): Promise<number> {
    const dir = this.active()
    if (!dir) return 0
    const files = [...(await this.list(dir, REC_SUB)), ...(await this.list(dir, SHOT_SUB))]
    const held = new Set((this.deps.held?.() ?? []).map((f) => path.resolve(f)))
    const gone = pickExpired(files, { now: (this.deps.now ?? Date.now)(), keepDays: this.cfg.keepDays, maxBytes: this.cfg.maxGb * 1024 ** 3 }).filter((f) => !held.has(path.resolve(f.path)))
    let n = 0
    for (const f of gone) if (await fs.rm(f.path, { force: true }).then(() => true, () => false)) n++
    return n
  }

  /** Startup: a crash leaves pulled recordings in temp (no token survives a restart) and unfinished ones in the folder. */
  async sweepOrphans(): Promise<number> {
    let n = 0
    const temp = path.join(this.deps.tmpRoot, TEMP_REC_DIR)
    for (const name of await fs.readdir(temp).catch(() => [] as string[])) {
      if (REC_FILE.test(name) && (await fs.rm(path.join(temp, name), { force: true }).then(() => true, () => false))) n++
    }
    const dir = this.active()
    if (dir) {
      for (const f of await this.list(dir, REC_SUB)) {
        if (!fileComplete(f.path) && (await fs.rm(f.path, { force: true }).then(() => true, () => false))) n++
      }
    }
    return n
  }

  start(): void {
    void this.sweepOrphans().then(() => this.sweep())
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS)
    this.timer.unref()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
