import { mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { DevCapture, DevSnapshot, McpRunResult, RunSession } from '@ccm/shared'
import { isRunLive } from '@ccm/shared'
import { SHOT_FILE, SHOT_MAX_BYTES, shotName } from '../capture/files'
import { isWithin } from '../preview/paths'

export const TEMP_SHOT_DIR = 'orrery-shots'
const TEMP_KEEP = 30

export interface McpShotDeps {
  snapshot: () => Promise<DevSnapshot>
  /** Runs its own ready check, like the Devices view. */
  screencap: (serial: string) => Promise<DevCapture>
  runs: () => RunSession[]
  /** The capture folder's `shots/` writer; null when no folder is set (or it is gone). */
  writeShot: (png: Buffer, device: string) => Promise<string | null>
  captureActive: () => boolean
  tmpRoot: string
  now?: () => number
  /** The PTY host stops waiting after 8 s; past this the shot is dropped, not saved late. */
  deadlineMs?: number
}

export const SHOT_DEADLINE_MS = 7_000

type Shot = Extract<McpRunResult, { tool: 'device_screenshot' }>
const refuse = (code: string, extra: Partial<Shot> = {}): Shot => ({ ok: true, tool: 'device_screenshot', refused: { code }, ...extra })

/** Without a capture folder: `<tmp>/orrery-shots`, only Orrery-named files, the newest TEMP_KEEP kept. */
export async function writeTempShot(tmpRoot: string, png: Buffer, device: string, at: Date): Promise<string | null> {
  const dir = path.join(tmpRoot, TEMP_SHOT_DIR)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return null
  }
  let file: string | null = null
  for (let dup = 1; dup <= 50 && !file; dup++) {
    const target = path.join(dir, shotName(device, at, null, dup))
    try {
      await fs.writeFile(target, png, { flag: 'wx' })
      file = target
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return null
    }
  }
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => SHOT_FILE.test(n))
  const stats = await Promise.all(names.map(async (n) => ({ f: path.join(dir, n), t: (await fs.stat(path.join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })))
  for (const old of stats.sort((a, b) => b.t - a.t).slice(TEMP_KEEP)) if (old.f !== file) await fs.rm(old.f, { force: true }).catch(() => undefined)
  return file
}

/**
 * device_screenshot for one pane (docs §11w): serial must be a ready adb device; without one, the device of this
 * project's live run, else the only ready device. Never installs, never changes a setting.
 */
export function mcpScreenshot(call: { cwd: string; serial?: string }, deps: McpShotDeps): Promise<Shot> {
  let late = false
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<Shot>((resolve) => {
    timer = setTimeout(() => {
      late = true
      resolve(refuse('timeout'))
    }, deps.deadlineMs ?? SHOT_DEADLINE_MS)
  })
  return Promise.race([shoot(call, deps, () => late), deadline]).finally(() => clearTimeout(timer))
}

async function shoot(call: { cwd: string; serial?: string }, deps: McpShotDeps, late: () => boolean): Promise<Shot> {
  const snap = await deps.snapshot()
  if (!snap.adb) return refuse('adb-missing')
  const ready = snap.devices.filter((d) => d.online && d.state === 'ready')
  const listed = ready.map((d) => ({ serial: d.id, name: d.name }))
  let serial = call.serial
  if (serial) {
    if (!ready.some((d) => d.id === serial)) return refuse('not-connected', { devices: listed })
  } else {
    const ids = new Set(ready.map((d) => d.id))
    const run = deps
      .runs()
      .filter((s) => isRunLive(s.state) && s.deviceId && ids.has(s.deviceId) && isWithin(call.cwd, s.cwd))
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    serial = run?.deviceId ?? (ready.length === 1 ? ready[0]!.id : undefined)
    if (!serial) return ready.length ? refuse('several', { devices: listed }) : refuse('no-device')
  }
  const device = ready.find((d) => d.id === serial)!
  const cap = await deps.screencap(serial)
  if (!cap.ok) return refuse(['secure', 'timeout', 'adb-missing', 'not-connected'].includes(cap.error) ? cap.error : 'capture-failed')
  const png = Buffer.from(cap.png.replace(/^data:image\/png;base64,/, ''), 'base64')
  if (!png.length || png.length > SHOT_MAX_BYTES) return refuse('capture-failed')
  if (late()) return refuse('timeout')
  const label = device.name || serial
  const active = deps.captureActive()
  const file = active ? await deps.writeShot(png, label) : await writeTempShot(deps.tmpRoot, png, label, new Date((deps.now ?? Date.now)()))
  if (!file) return refuse('write-failed')
  return { ok: true, tool: 'device_screenshot', shot: { path: file, width: cap.width, height: cap.height, serial, name: label, saved: active ? 'capture' : 'temp' } }
}
