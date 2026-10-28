import type { LogLevel } from '@ccm/shared'

export const LOG_LEVELS: readonly LogLevel[] = ['V', 'D', 'I', 'W', 'E', 'F']
/** Level index per line; -1 = no level found. */
export type LevelIndex = -1 | 0 | 1 | 2 | 3 | 4 | 5
/** Renderer keeps at most this much of a log loaded (the desktop reader refuses larger files). */
export const MAX_LOADED_BYTES = 200 * 1024 * 1024

const LETTER: Record<string, LevelIndex> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5, A: 5 }
const WORD: Record<string, LevelIndex> = {
  TRACE: 0, VERBOSE: 0, FINEST: 0, FINER: 0, FINE: 1, DEBUG: 1, INFO: 2, NOTICE: 2,
  WARN: 3, WARNING: 3, ERROR: 4, ERR: 4, SEVERE: 4, FATAL: 5, CRITICAL: 5, CRIT: 5, PANIC: 5, ASSERT: 5,
}

// logcat threadtime / time ("01-02 03:04:05.678  123  456 E Tag: …", Android Studio "… pkg  E  msg") and brief ("E/Tag( 123): …").
const LOGCAT_TIME = /^(?:\d{4}-)?\d\d-\d\d\s+\d\d:\d\d:\d\d[.,]\d+(?:\s+\S+){0,4}?\s+([VDIWEFA])[\s/]/
const LOGCAT_BRIEF = /^([VDIWEFA])\/[^:(]{0,120}(?:\(\s*\d+\))?:/
const WORD_UPPER = /(?:^|[\s[(|<"'])(TRACE|VERBOSE|FINEST|FINER|FINE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|SEVERE|FATAL|CRITICAL|CRIT|PANIC|ASSERT)(?=$|[\s\]):|>,"'-])/
const WORD_ANY = /(?:\[|\blevel[=:]\s*"?|\blvl[=:]\s*"?)(trace|debug|info|notice|warn|warning|error|err|fatal|critical|panic)\b/i
const CONTINUATION = /^(?:\s+\S|\s*at\s|\s*Caused by:|\s*\.\.\.\s*\d+\s+more|\s*Suppressed:)/

/** Level a line states itself, or -1. Only the head of a line is searched, so a message quoting "ERROR" later stays plain. */
export function lineLevel(line: string): LevelIndex {
  const head = line.length > 240 ? line.slice(0, 240) : line
  const lc = LOGCAT_TIME.exec(head) ?? LOGCAT_BRIEF.exec(head)
  if (lc) return LETTER[lc[1]!]!
  const up = WORD_UPPER.exec(head.slice(0, 160))
  if (up) return WORD[up[1]!]!
  const any = WORD_ANY.exec(head.slice(0, 160))
  if (any) return WORD[any[1]!.toUpperCase()] ?? -1
  return -1
}

/** Stack frames and indented lines belong to the entry above them. */
export const isContinuation = (line: string): boolean => CONTINUATION.test(line)

export function levelsOf(lines: readonly string[], prev: LevelIndex = -1): LevelIndex[] {
  const out: LevelIndex[] = new Array(lines.length)
  let last = prev
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const own = lineLevel(line)
    if (own >= 0) last = out[i] = own
    else if (isContinuation(line)) out[i] = last
    else {
      out[i] = -1
      if (line.trim()) last = -1
    }
  }
  return out
}

/** Lines of a chunk; `open` = the chunk did not end with a line break (its last line may still grow). */
export function splitChunk(text: string, atStart: boolean): { lines: string[]; open: boolean } {
  let t = atStart && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (!t) return { lines: [], open: false }
  const open = !t.endsWith('\n')
  if (!open) t = t.replace(/\r?\n$/, '')
  return { lines: t.split(/\r?\n/), open }
}

export interface LogBuffer {
  lines: string[]
  levels: LevelIndex[]
  /** Byte range of the file the lines cover. */
  start: number
  end: number
  open: boolean
}

export const emptyBuffer = (): LogBuffer => ({ lines: [], levels: [], start: 0, end: 0, open: false })

/** Buffer of the newest chunk (initial tail or after a truncation). */
export function fromTail(text: string, start: number, end: number): LogBuffer {
  const { lines, open } = splitChunk(text, start === 0)
  return { lines, levels: levelsOf(lines), start, end, open }
}

/** Older chunk read backwards (it ends on a line break, right before `buf.start`). */
export function prependChunk(buf: LogBuffer, text: string, start: number): LogBuffer {
  const { lines } = splitChunk(text, start === 0)
  const levels = levelsOf(lines)
  // The first loaded lines may be continuations of an entry that now sits above them.
  const relevel = levelsOf(buf.lines.slice(0, 64), levels.length ? levels[levels.length - 1] : -1)
  const tail = buf.levels.slice()
  relevel.forEach((lv, i) => (tail[i] = lv))
  return { ...buf, lines: lines.concat(buf.lines), levels: levels.concat(tail), start }
}

/** Newer complete lines read forward from `buf.end`; an open last line takes the first piece. */
export function appendChunk(buf: LogBuffer, text: string, end: number): LogBuffer {
  if (!text) return { ...buf, end: Math.max(buf.end, end) }
  const { lines, open } = splitChunk(text, false)
  const outLines = buf.lines.slice()
  const outLevels = buf.levels.slice()
  let fresh = lines
  if (buf.open && outLines.length && fresh.length) {
    const i = outLines.length - 1
    outLines[i] = outLines[i]! + fresh[0]!
    outLevels[i] = levelsOf([outLines[i]!], i > 0 ? outLevels[i - 1]! : -1)[0]!
    fresh = fresh.slice(1)
  }
  const levels = levelsOf(fresh, outLevels.length ? outLevels[outLevels.length - 1]! : -1)
  return { ...buf, lines: outLines.concat(fresh), levels: outLevels.concat(levels), end, open: open || (buf.open && !lines.length) }
}

/** Indices of lines passing the min level (-1 = all, unleveled lines too) and the case-insensitive text filter. */
export function filterLines(buf: Pick<LogBuffer, 'lines' | 'levels'>, minLevel: LevelIndex, query: string): number[] | null {
  const q = query.trim().toLowerCase()
  if (minLevel < 0 && !q) return null
  const out: number[] = []
  for (let i = 0; i < buf.lines.length; i++) {
    if (minLevel >= 0 && buf.levels[i]! < minLevel) continue
    if (q && !buf.lines[i]!.toLowerCase().includes(q)) continue
    out.push(i)
  }
  return out
}

export const isLogFile = (path: string): boolean => {
  const base = path.replace(/\\/g, '/').split('/').pop()!.toLowerCase()
  return base.endsWith('.log') || /^logcat.*\.txt$/.test(base)
}

export function levelCounts(levels: readonly LevelIndex[]): number[] {
  const out = [0, 0, 0, 0, 0, 0]
  for (const lv of levels) if (lv >= 0) out[lv]!++
  return out
}
