import path from 'node:path'
import { CAPTURE_KEEP_DAYS, CAPTURE_MAX_GB, DEFAULT_CAPTURE, type CaptureConfig } from '@ccm/shared'

export const CAPTURE_FILE = 'capture.json'
export const REC_SUB = 'recordings'
export const SHOT_SUB = 'shots'
export const SWEEP_EVERY_MS = 6 * 60 * 60_000
export const SHOT_MAX_BYTES = 32 * 1024 * 1024
const DAY_MS = 24 * 60 * 60_000

export const REC_FILE = /^orrery-rec-\d{10,16}\.mp4$/
export const SHOT_FILE = /^[A-Za-z0-9._-]{1,40}-\d{8}-\d{6}(-\d{1,3})?(-f\d{1,3})?\.png$/

/** Only names Orrery itself writes are ever deleted from the capture folder. */
export function isOrreryFile(sub: string, name: string): boolean {
  if (sub === REC_SUB) return REC_FILE.test(name)
  if (sub === SHOT_SUB) return SHOT_FILE.test(name)
  return false
}

export function sanitizeDevice(name: string): string {
  const s = name
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
    .replace(/[-.]+$/, '')
  return s || 'device'
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** Local time `yyyyMMdd-HHmmss`. */
export const stamp = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/** `<device>-<yyyyMMdd-HHmmss>[-n][-fN].png`; `dup` > 1 when the same second is taken. */
export function shotName(device: string, d: Date, frame?: number | null, dup = 1): string {
  return `${sanitizeDevice(device)}-${stamp(d)}${dup > 1 ? `-${dup}` : ''}${frame ? `-f${frame}` : ''}.png`
}

export interface CapturedFile {
  path: string
  size: number
  mtimeMs: number
}

/** Files past `keepDays`, then the oldest until the rest fits in `maxBytes`. */
export function pickExpired(files: readonly CapturedFile[], o: { now: number; keepDays: number; maxBytes: number }): CapturedFile[] {
  const out: CapturedFile[] = []
  const kept: CapturedFile[] = []
  for (const f of files) (o.now - f.mtimeMs > o.keepDays * DAY_MS ? out : kept).push(f)
  let total = 0
  for (const f of [...kept].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    total += f.size
    if (total > o.maxBytes) out.push(f)
  }
  return out
}

/** An absolute folder path from config / a picker; null when unusable. */
export function cleanDir(raw: unknown, win = process.platform === 'win32'): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 1024 || /[\0\r\n]/.test(raw)) return null
  const p = win ? path.win32 : path.posix
  if (!p.isAbsolute(raw)) return null
  // A bare `\foo` on Windows is drive-relative: refuse it.
  if (win && !/^([A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(raw)) return null
  return p.resolve(raw)
}

export function isInside(root: string, file: string, win = process.platform === 'win32'): boolean {
  const p = win ? path.win32 : path.posix
  const rel = p.relative(win ? root.toLowerCase() : root, win ? file.toLowerCase() : file)
  return !!rel && !rel.startsWith('..') && !p.isAbsolute(rel)
}

export function parseConfig(raw: unknown): CaptureConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    dir: cleanDir(r.dir),
    asFile: typeof r.asFile === 'boolean' ? r.asFile : DEFAULT_CAPTURE.asFile,
    keepDays: (CAPTURE_KEEP_DAYS as readonly unknown[]).includes(r.keepDays) ? (r.keepDays as number) : DEFAULT_CAPTURE.keepDays,
    maxGb: (CAPTURE_MAX_GB as readonly unknown[]).includes(r.maxGb) ? (r.maxGb as number) : DEFAULT_CAPTURE.maxGb,
  }
}

/** Page patch: the folder itself only comes from the native picker, the page may only clear it. */
export function parsePatch(raw: unknown): Partial<CaptureConfig> | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: Partial<CaptureConfig> = {}
  if ('dir' in r) {
    if (r.dir !== null) return null
    out.dir = null
  }
  if ('asFile' in r) {
    if (typeof r.asFile !== 'boolean') return null
    out.asFile = r.asFile
  }
  if ('keepDays' in r) {
    if (!(CAPTURE_KEEP_DAYS as readonly unknown[]).includes(r.keepDays)) return null
    out.keepDays = r.keepDays as number
  }
  if ('maxGb' in r) {
    if (!(CAPTURE_MAX_GB as readonly unknown[]).includes(r.maxGb)) return null
    out.maxGb = r.maxGb as number
  }
  return out
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function decodePng(dataUrl: unknown): Buffer | null {
  const prefix = 'data:image/png;base64,'
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length > (SHOT_MAX_BYTES * 4) / 3 + prefix.length + 4) return null
  const buf = Buffer.from(dataUrl.slice(prefix.length), 'base64')
  return buf.length > PNG_SIG.length && PNG_SIG.every((b, i) => buf[i] === b) ? buf : null
}

export function parseShotRequest(raw: unknown): { png: Buffer; device: string; frame: number | null } | null {
  const r = raw as { png?: unknown; device?: unknown; frame?: unknown } | null
  if (!r || typeof r !== 'object' || typeof r.device !== 'string' || r.device.length > 200) return null
  const frame = r.frame === undefined || r.frame === null ? null : r.frame
  if (frame !== null && (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 1 || frame > 999)) return null
  const png = decodePng(r.png)
  return png ? { png, device: r.device, frame } : null
}
