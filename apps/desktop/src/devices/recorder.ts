import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync, readSync, rmSync, statSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { DevErrorCode, DevFailure, DevRecResult, DevRecSave, DevRecStart } from '@ccm/shared'
import type { AdbCommands } from './adb'
import { shQuote } from './uiToggles'

export const REC_LIMIT_S = 30
export const REC_BIT_RATE = 8_000_000
/** Frames held while recording; past this every second one is dropped and the interval doubles, so they stay evenly spaced. */
export const FRAMES_KEEP = 16
export const FRAMES_PICK = 6
export const TOKENS_MAX = 3
const TIMING = { frameMs: 1_000, startCheckMs: 800, stopWaitMs: 6_000, pullMs: 120_000, cmdMs: 10_000, orphanMs: (REC_LIMIT_S + 60) * 1_000 }

export const isRecToken = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v)
export const remoteName = (ts: number): string => `orrery-rec-${ts}`
export const remotePath = (ts: number): string => `/sdcard/${remoteName(ts)}.mp4`
export const recordArgs = (ts: number): string[] => ['screenrecord', '--time-limit', String(REC_LIMIT_S), '--bit-rate', String(REC_BIT_RATE), remotePath(ts)]
// SIGINT lets screenrecord write the moov box; only our own process (matched by its file name) is stopped.
export const stopArgs = (ts: number): string[] => ['pkill', '-INT', '-f', shQuote(remoteName(ts))]
export const removeArgs = (ts: number): string[] => ['rm', '-f', shQuote(remotePath(ts))]

/** Halves `frames` (keeps 0, 2, 4…) once it grows past `keep`; the caller doubles its interval. */
export function thinFrames<T>(frames: T[], keep = FRAMES_KEEP): { frames: T[]; thinned: boolean } {
  return frames.length > keep ? { frames: frames.filter((_, i) => i % 2 === 0), thinned: true } : { frames, thinned: false }
}

/** `n` items spread evenly over `list`, first and last included. */
export function pickEven<T>(list: readonly T[], n = FRAMES_PICK): T[] {
  if (list.length <= n) return [...list]
  if (n <= 1) return list.slice(0, Math.max(0, n))
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]!)
}

/** True when the top-level boxes span the file, the first is `ftyp` and a `moov` exists (a killed recorder leaves none). */
export function mp4Complete(read: (pos: number, len: number) => Uint8Array, size: number): boolean {
  let pos = 0
  let first = true
  let moov = false
  for (let n = 0; pos < size && n < 10_000; n++) {
    const h = read(pos, 16)
    if (h.length < 8) return false
    const view = new DataView(h.buffer, h.byteOffset, h.byteLength)
    let len = view.getUint32(0)
    const type = String.fromCharCode(h[4]!, h[5]!, h[6]!, h[7]!)
    if (len === 1) {
      if (h.length < 16) return false
      len = Number(view.getBigUint64(8))
    } else if (len === 0) len = size - pos
    if (len < 8 || pos + len > size) return false
    if (first && type !== 'ftyp') return false
    first = false
    if (type === 'moov') moov = true
    pos += len
  }
  return moov && pos === size
}

function fileComplete(file: string): boolean {
  let fd: number | null = null
  try {
    const size = statSync(file).size
    fd = openSync(file, 'r')
    const handle = fd
    return size > 0 && mp4Complete((pos, len) => {
      const buf = Buffer.alloc(len)
      return buf.subarray(0, readSync(handle, buf, 0, len, pos))
    }, size)
  } catch {
    return false
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

export interface RecorderDeps {
  withDevice: <T>(id: string, fn: (cmds: AdbCommands) => Promise<T>) => Promise<T | DevFailure>
  tmpDir: string
  kill: (child: ChildProcess) => void
  now?: () => number
  timing?: Partial<typeof TIMING>
}

interface Session {
  ts: number
  cmds: AdbCommands
  child: ChildProcess
  exited: Promise<number | null>
  alive: boolean
  out: string
  startedAt: number
  frames: string[]
  framesFailed: number
  frameMs: number
  frameTimer: NodeJS.Timeout | null
  orphanTimer: NodeJS.Timeout | null
  done: boolean
  stopping: Promise<DevRecResult> | null
}

const fail = (error: DevErrorCode, detail?: string): DevFailure => (detail ? { ok: false, error, detail } : { ok: false, error })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** One `adb shell screenrecord` per device, screencap frames alongside, the MP4 pulled to a temp file kept under a token. */
export class ScreenRecorder {
  private readonly t: typeof TIMING
  private readonly sessions = new Map<string, Session>()
  private readonly files = new Map<string, string>()
  private lastTs = 0

  constructor(private readonly deps: RecorderDeps) {
    this.t = { ...TIMING, ...deps.timing }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  isRecording(id: string): boolean {
    return this.sessions.has(id)
  }

  async start(id: string): Promise<DevRecStart> {
    if (this.sessions.has(id)) return fail('busy')
    const ts = Math.max(this.now(), this.lastTs + 1)
    this.lastTs = ts
    const placeholder = {} as Session
    this.sessions.set(id, placeholder)
    const r = await this.deps.withDevice(id, async (cmds): Promise<DevRecStart> => {
      const child = await cmds.spawnShell(id, recordArgs(ts))
      if (!child) return fail('adb-missing')
      const s: Session = {
        ts,
        cmds,
        child,
        exited: new Promise((resolve) => {
          child.once('close', (code: number | null) => resolve(code))
          child.once('error', () => resolve(null))
        }),
        alive: true,
        out: '',
        startedAt: this.now(),
        frames: [],
        framesFailed: 0,
        frameMs: this.t.frameMs,
        frameTimer: null,
        orphanTimer: null,
        done: false,
        stopping: null,
      }
      const keep = (d: Buffer | string): void => {
        s.out = (s.out + d.toString()).slice(-2048)
      }
      child.stdout?.on('data', keep)
      child.stderr?.on('data', keep)
      void s.exited.then(() => (s.alive = false))
      // screenrecord refuses at once (no encoder, bad size, missing binary); a running one prints nothing.
      const early = await Promise.race([s.exited.then(() => true), sleep(this.t.startCheckMs).then(() => false)])
      if (early) {
        await cmds.shell(id, removeArgs(ts), this.t.cmdMs)
        return fail('record-failed', s.out.replace(/\s+/g, ' ').trim().slice(0, 300) || undefined)
      }
      this.sessions.set(id, s)
      s.orphanTimer = setTimeout(() => void this.cancel(id), this.t.orphanMs)
      void this.frame(id, s)
      return { ok: true, startedAt: s.startedAt, limitMs: REC_LIMIT_S * 1000 }
    })
    if (!r.ok && this.sessions.get(id) === placeholder) this.sessions.delete(id)
    return r
  }

  private async frame(id: string, s: Session): Promise<void> {
    if (s.done) return
    const shot = await s.cmds.screencap(id)
    if (s.done) return
    if (shot.ok) {
      const next = thinFrames([...s.frames, shot.png])
      s.frames = next.frames
      if (next.thinned) s.frameMs *= 2
    } else s.framesFailed++
    s.frameTimer = setTimeout(() => void this.frame(id, s), s.frameMs)
  }

  private halt(s: Session): void {
    s.done = true
    if (s.frameTimer) clearTimeout(s.frameTimer)
    if (s.orphanTimer) clearTimeout(s.orphanTimer)
  }

  private async finishProcess(id: string, s: Session): Promise<void> {
    if (s.alive) await s.cmds.shell(id, stopArgs(s.ts), this.t.cmdMs)
    const ended = await Promise.race([s.exited.then(() => true), sleep(this.t.stopWaitMs).then(() => false)])
    if (!ended) this.deps.kill(s.child)
  }

  stop(id: string): Promise<DevRecResult> {
    const s = this.sessions.get(id)
    if (!s?.cmds) return Promise.resolve(fail('invalid'))
    s.stopping ??= this.finish(id, s).finally(() => this.sessions.delete(id))
    return s.stopping
  }

  private async finish(id: string, s: Session): Promise<DevRecResult> {
    this.halt(s)
    const durationMs = Math.min(this.now() - s.startedAt, REC_LIMIT_S * 1000)
    const local = path.join(this.deps.tmpDir, `${remoteName(s.ts)}.mp4`)
    try {
      await this.finishProcess(id, s)
      await fs.mkdir(this.deps.tmpDir, { recursive: true })
      const pulled = await s.cmds.pull(id, remotePath(s.ts), local, this.t.pullMs)
      if (!pulled) return fail('adb-missing')
      if (pulled.timedOut) return fail('timeout')
      if (pulled.code !== 0 || !fileComplete(local)) {
        await fs.rm(local, { force: true })
        return fail('record-failed', `${pulled.out} ${s.out}`.replace(/\s+/g, ' ').trim().slice(0, 300) || undefined)
      }
      const bytes = (await fs.stat(local)).size
      const token = randomBytes(16).toString('hex')
      this.files.set(token, local)
      while (this.files.size > TOKENS_MAX) this.discard(this.files.keys().next().value!)
      return { ok: true, token, bytes, durationMs, frames: pickEven(s.frames), framesFailed: s.framesFailed }
    } catch (e) {
      await fs.rm(local, { force: true }).catch(() => undefined)
      return fail('record-failed', e instanceof Error ? e.message.slice(0, 300) : undefined)
    } finally {
      await s.cmds.shell(id, removeArgs(s.ts), this.t.cmdMs)
    }
  }

  /** Dialog closed while recording: stop, drop everything, remove the device file. */
  async cancel(id: string): Promise<{ ok: true } | DevFailure> {
    const s = this.sessions.get(id)
    if (!s?.cmds) return fail('invalid')
    if (s.stopping) {
      const r = await s.stopping
      if (r.ok) this.discard(r.token)
      return { ok: true }
    }
    this.halt(s)
    s.stopping = Promise.resolve(fail('cancelled'))
    try {
      await this.finishProcess(id, s)
    } finally {
      await s.cmds.shell(id, removeArgs(s.ts), this.t.cmdMs)
      this.sessions.delete(id)
    }
    return { ok: true }
  }

  async save(token: string, dest: string | null): Promise<DevRecSave> {
    const file = this.files.get(token)
    if (!file) return fail('invalid')
    if (!dest) return fail('cancelled')
    try {
      await fs.copyFile(file, dest)
      return { ok: true, name: path.basename(dest) }
    } catch (e) {
      return fail('record-failed', e instanceof Error ? e.message.slice(0, 300) : undefined)
    }
  }

  hasFile(token: string): boolean {
    return this.files.has(token)
  }

  discard(token: string): boolean {
    const file = this.files.get(token)
    if (!file) return false
    this.files.delete(token)
    rmSync(file, { force: true })
    return true
  }

  /** App quit: kill recorders, ask the devices to drop their files (not awaited), delete temp files. */
  dispose(): void {
    for (const [id, s] of this.sessions) {
      if (!s.cmds) continue
      this.halt(s)
      if (s.alive) this.deps.kill(s.child)
      void s.cmds
        .shell(id, stopArgs(s.ts), this.t.cmdMs)
        .then(() => s.cmds.shell(id, removeArgs(s.ts), this.t.cmdMs))
        .catch(() => undefined)
    }
    this.sessions.clear()
    for (const token of [...this.files.keys()]) this.discard(token)
  }
}
