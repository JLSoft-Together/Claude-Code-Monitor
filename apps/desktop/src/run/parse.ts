import path from 'node:path'
import type { BuildError, LogLevel, RunDevice } from '@ccm/shared'
import { parseAdbDeviceRows } from '../devices/parse'

export type MachineMessage =
  | { kind: 'event'; event: string; params: Record<string, unknown> }
  | { kind: 'response'; id: number; result?: unknown; error?: unknown }
  | { kind: 'text'; text: string }

// `flutter run --machine` / `flutter daemon` wrap every message as a one-element JSON array on its own line.
export function parseMachineLine(line: string): MachineMessage {
  const t = line.trim()
  if (!t.startsWith('[{') || !t.endsWith('}]')) return { kind: 'text', text: line }
  try {
    const arr = JSON.parse(t) as unknown
    const msg = Array.isArray(arr) ? (arr[0] as Record<string, unknown>) : null
    if (!msg || typeof msg !== 'object') return { kind: 'text', text: line }
    if (typeof msg.event === 'string') {
      const params = msg.params && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {}
      return { kind: 'event', event: msg.event, params }
    }
    if (typeof msg.id === 'number') return { kind: 'response', id: msg.id, result: msg.result, error: msg.error }
  } catch {
    // Not JSON after all (e.g. Gradle output that happens to start with "[{").
  }
  return { kind: 'text', text: line }
}

export function machineRequest(id: number, method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify([{ id, method, params }]) + '\n'
}

const MAX_LINE = 64 * 1024

/** Splits a byte stream into lines. A throwing `onLine` drops that line only; an endless line is emitted in 64 KB pieces. */
export function lineSplitter(onLine: (line: string) => void): { push: (chunk: Buffer | string) => void; flush: () => void } {
  let rest = ''
  const emit = (line: string): void => {
    try {
      onLine(line)
    } catch {
      // A parser bug must not surface as an uncaught 'data' handler error in main.
    }
  }
  return {
    push(chunk) {
      const parts = (rest + chunk.toString()).split(/\r?\n/)
      rest = parts.pop() ?? ''
      for (const p of parts) emit(p)
      while (rest.length > MAX_LINE) {
        emit(rest.slice(0, MAX_LINE))
        rest = rest.slice(MAX_LINE)
      }
    },
    flush() {
      if (rest) emit(rest)
      rest = ''
    },
  }
}

const decodeUri = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const KOTLIN_URI = /^([ew]): file:\/\/(\/?[^:]+(?::[^:]+)?):(\d+):(\d+) (.+)$/
const KOTLIN_OLD = /^([ew]): (.+?): \((\d+), (\d+)\): (.+)$/
const JAVAC = /^(.+?\.java):(\d+): (error|warning): (.+)$/
const AAPT = /^(?:ERROR|WARNING):\s*(.+?\.xml):(\d+):\s*(?:AAPT: )?(?:error|warning)?:?\s*(.+)$/i
const DART = /^(.+?\.dart):(\d+):(\d+): (Error|Warning): (.+)$/

function absolute(file: string, cwd: string): string {
  const f = file.trim()
  if (/^[A-Za-z]:[\\/]/.test(f) || f.startsWith('/')) return path.normalize(f)
  return path.join(cwd, f)
}

function groups(re: RegExp, text: string): string[] | null {
  const m = re.exec(text)
  return m ? Array.from(m, (g) => g ?? '') : null
}

export function parseBuildError(line: string, cwd: string): BuildError | null {
  const text = line.trimEnd()
  const err = (file: string, ln: string, col: string, message: string, error: boolean): BuildError => ({
    file: absolute(file, cwd),
    line: Number(ln),
    col: Number(col),
    message,
    severity: error ? 'error' : 'warning',
  })
  let m = groups(KOTLIN_URI, text)
  if (m) {
    const [, sev = '', uri = '', ln = '', col = '', msg = ''] = m
    return err(decodeUri(uri).replace(/^\/([A-Za-z]:)/, '$1'), ln, col, msg, sev === 'e')
  }
  m = groups(KOTLIN_OLD, text)
  if (m) {
    const [, sev = '', file = '', ln = '', col = '', msg = ''] = m
    return err(file, ln, col, msg, sev === 'e')
  }
  m = groups(JAVAC, text)
  if (m) {
    const [, file = '', ln = '', sev = '', msg = ''] = m
    return err(file, ln, '1', msg, sev === 'error')
  }
  m = groups(DART, text)
  if (m) {
    const [, file = '', ln = '', col = '', sev = '', msg = ''] = m
    return err(file, ln, col, msg, sev === 'Error')
  }
  m = groups(AAPT, text)
  if (m) {
    const [, file = '', ln = '', msg = ''] = m
    return err(file, ln, '1', msg, !/^warning/i.test(text))
  }
  return null
}

// `logcat -v threadtime`: "10-15 12:34:56.789  1234  1250 I Tag     : message"
const THREADTIME = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}\s+\d+\s+\d+\s+([VDIWEF])\s+(.*?)\s*: (.*)$/

export function parseLogcat(line: string): { level: LogLevel; tag: string; text: string } | null {
  const m = groups(THREADTIME, line)
  return m ? { level: m[1] as LogLevel, tag: m[2] ?? '', text: m[3] ?? '' } : null
}

/** `adb devices -l` body, or one `track-devices` frame (same line format). */
export function parseAdbDevices(out: string): RunDevice[] {
  return parseAdbDeviceRows(out)
    .filter((r) => r.state === 'ready' || r.state === 'unauthorized' || r.state === 'offline')
    .map((r) => ({
      id: r.id,
      name: r.model ?? r.id,
      platform: 'android',
      emulator: r.id.startsWith('emulator-'),
      state: r.state as RunDevice['state'],
      source: 'adb',
    }))
}

/** `adb track-devices` frames: 4 hex digits length + payload, back to back. Returns parsed frames and the unparsed tail. */
export function readAdbFrames(buf: string): { frames: string[]; rest: string } {
  const frames: string[] = []
  let i = 0
  while (buf.length - i >= 4) {
    const len = parseInt(buf.slice(i, i + 4), 16)
    if (Number.isNaN(len) || buf.length - i - 4 < len) break
    frames.push(buf.slice(i + 4, i + 4 + len))
    i += 4 + len
  }
  return { frames, rest: buf.slice(i) }
}

export function parseOutputMetadata(json: string, dir: string): { apk: string; applicationId: string } | null {
  try {
    const meta = JSON.parse(json) as { applicationId?: unknown; elements?: { outputFile?: unknown }[] }
    const file = meta.elements?.find((e) => typeof e.outputFile === 'string')?.outputFile
    if (typeof meta.applicationId !== 'string' || typeof file !== 'string') return null
    return { apk: path.join(dir, file), applicationId: meta.applicationId }
  } catch {
    return null
  }
}

/** Last line of `cmd package resolve-activity --brief <pkg>`: `pkg/.Main` or `pkg/pkg.Main`. */
export function parseResolvedActivity(out: string, pkg: string): string | null {
  const last = out.trim().split(/\r?\n/).pop()?.trim() ?? ''
  return last.startsWith(pkg + '/') ? last : null
}

/** `pidof -s` / `pidof` output → lowest pid (pidof lists newest first; numeric sort is stable across devices). */
export function firstPid(out: string): string | null {
  const pids = out.trim().split(/\s+/).filter((t) => /^\d+$/.test(t))
  return pids.length ? pids.sort((a, b) => Number(a) - Number(b))[0]! : null
}

/** `pidof` missing on the device (old toybox / busybox-less images). */
export const pidofMissing = (code: number | null, out: string): boolean => code === 127 || /\bpidof\b.*(?:not found|inaccessible)/i.test(out)

/** `ps -A -o PID,NAME` or legacy `ps` (USER PID PPID … NAME): the lowest pid whose last column is `pkg`. */
export function psPid(out: string, pkg: string): string | null {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const header = lines[0]?.split(/\s+/) ?? []
  const col = header.indexOf('PID')
  if (col < 0) return null
  const pids: string[] = []
  for (const line of lines.slice(1)) {
    const cols = line.split(/\s+/)
    if (cols[cols.length - 1] === pkg && /^\d+$/.test(cols[col] ?? '')) pids.push(cols[col]!)
  }
  return pids.length ? pids.sort((a, b) => Number(a) - Number(b))[0]! : null
}

export type InstallFailure = 'signature' | 'storage' | 'abi' | 'version-downgrade' | 'other'

export function installFailure(out: string): InstallFailure | null {
  if (/^Success\s*$/m.test(out)) return null
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES/.test(out)) return 'signature'
  if (/INSUFFICIENT_STORAGE/.test(out)) return 'storage'
  if (/NO_MATCHING_ABIS/.test(out)) return 'abi'
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/.test(out)) return 'version-downgrade'
  return 'other'
}

/** `flutter daemon` `device.added` params / `flutter devices --machine` entries. */
export function flutterDevice(raw: unknown): RunDevice | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (typeof d.id !== 'string' || typeof d.name !== 'string') return null
  return {
    id: d.id,
    name: d.name,
    platform: typeof d.platform === 'string' ? d.platform : typeof d.targetPlatform === 'string' ? d.targetPlatform : 'unknown',
    emulator: d.emulator === true,
    state: d.isSupported === false ? 'offline' : 'ready',
    source: 'flutter',
  }
}
