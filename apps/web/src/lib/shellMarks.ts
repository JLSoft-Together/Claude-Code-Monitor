import { redactLine } from './runCrash'

/** OSC 633 (VS Code) / 133 (FinalTerm) command marks a shell pane's prompt hooks print. */
export type ShellMark =
  | { kind: 'promptStart' }
  | { kind: 'commandStart' }
  | { kind: 'executed' }
  /** `exitCode` null: the shell reported no command (empty line, Ctrl+C at the prompt). */
  | { kind: 'finished'; exitCode: number | null }
  | { kind: 'commandLine'; command: string; nonce: string | null }

export const COMMANDS_MAX = 500
export const COMMAND_TEXT_MAX = 2000
/** A command that ran this long gets a notification when it ends out of sight. */
export const LONG_COMMAND_MS = 30_000
export const OUTPUT_PROMPT_MAX = 4000

export function unescapeValue(text: string): string {
  return text.replace(/\\x([0-9a-fA-F]{2})|\\\\/g, (m, hex: string | undefined) => (hex ? String.fromCharCode(parseInt(hex, 16)) : '\\'))
}

/** Same escaping the shell scripts apply (VS Code's): `\`, `;` and control characters as `\xNN`. */
export function escapeValue(text: string): string {
  return text.replace(/[\x00-\x1f\x7f\\;]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

export function parseMark(data: string): ShellMark | null {
  const semi = data.indexOf(';')
  const code = semi < 0 ? data : data.slice(0, semi)
  const rest = semi < 0 ? null : data.slice(semi + 1)
  switch (code) {
    case 'A':
      return { kind: 'promptStart' }
    case 'B':
      return { kind: 'commandStart' }
    case 'C':
      return { kind: 'executed' }
    case 'D': {
      const n = rest !== null && /^-?\d{1,10}$/.test(rest) ? Number(rest) : NaN
      return { kind: 'finished', exitCode: Number.isSafeInteger(n) ? n : null }
    }
    case 'E': {
      if (rest === null) return { kind: 'commandLine', command: '', nonce: null }
      const parts = rest.split(';')
      return { kind: 'commandLine', command: unescapeValue(parts[0] ?? '').slice(0, COMMAND_TEXT_MAX), nonce: parts.length > 1 ? (parts[1] ?? null) : null }
    }
    default:
      return null
  }
}

export interface MarkerLike {
  readonly line: number
  readonly isDisposed: boolean
  dispose(): void
}

export interface ShellCommand<M extends MarkerLike = MarkerLike> {
  id: number
  prompt?: M
  start?: M
  /** Column of the command start (after the prompt) on `start`'s line. */
  startX: number
  output?: M
  end?: M
  command: string
  /** The command line came from the shell itself (E mark with this session's nonce), so it may be run again. */
  trusted: boolean
  executedAt?: number
  endedAt?: number
  exitCode?: number
  /** Unknown for commands replayed after a reconnect. */
  elapsedMs?: number
}

/** Pure bookkeeping of a pane's commands; markers belong to the caller, which hands them over per mark. */
export class CommandTracker<M extends MarkerLike = MarkerLike> {
  readonly done: ShellCommand<M>[] = []
  private pending: ShellCommand<M> | null = null
  private seq = 0

  constructor(
    private readonly max = COMMANDS_MAX,
    private readonly onDrop: (cmd: ShellCommand<M>) => void = () => undefined,
  ) {}

  /** The command being typed or running (between A and D). */
  get current(): ShellCommand<M> | null {
    return this.pending
  }

  promptStart(marker: M): void {
    this.discardPending()
    this.pending = { id: ++this.seq, prompt: marker, startX: 0, command: '', trusted: false }
  }

  commandStart(marker: M, x: number): void {
    const p = (this.pending ??= { id: ++this.seq, startX: 0, command: '', trusted: false })
    p.start?.dispose()
    p.start = marker
    p.startX = x
  }

  commandLine(command: string, trusted: boolean): void {
    if (!this.pending) return
    this.pending.command = command
    this.pending.trusted = trusted
  }

  /** `typed`: what the screen shows between the command start and here, used when no E mark came. */
  executed(marker: M, now: number, typed: () => string): void {
    const p = (this.pending ??= { id: ++this.seq, startX: 0, command: '', trusted: false })
    p.output?.dispose()
    p.output = marker
    p.executedAt = now
    if (!p.command.trim()) {
      p.command = typed().trim().slice(0, COMMAND_TEXT_MAX)
      p.trusted = false
    }
  }

  /** The finished command, or null when nothing ran (no executed mark, no exit code, blank line). */
  finished(exitCode: number | null, marker: M, now: number, replaying: boolean): ShellCommand<M> | null {
    const p = this.pending
    this.pending = null
    if (!p || !p.output || exitCode === null || !p.command.trim() || p.executedAt === undefined) {
      marker.dispose()
      if (p) this.release(p)
      return null
    }
    p.end = marker
    p.exitCode = exitCode
    p.endedAt = now
    p.elapsedMs = replaying ? undefined : Math.max(0, now - p.executedAt)
    this.done.push(p)
    while (this.done.length > this.max) this.drop(this.done[0]!)
    return p
  }

  /** A marker fell out of the scrollback: the command can no longer be shown. */
  drop(cmd: ShellCommand<M>): void {
    const i = this.done.indexOf(cmd)
    if (i < 0) return
    this.done.splice(i, 1)
    this.release(cmd)
    this.onDrop(cmd)
  }

  clear(): void {
    this.discardPending()
    for (const cmd of [...this.done]) this.drop(cmd)
  }

  /** Nearest command above (`dir` -1) or below (+1) `line`, by its first line. */
  near(line: number, dir: -1 | 1): ShellCommand<M> | null {
    let best: ShellCommand<M> | null = null
    for (const c of this.done) {
      const at = lineOf(c)
      if (at < 0) continue
      if (dir < 0 ? at < line && (!best || at > lineOf(best)) : at > line && (!best || at < lineOf(best))) best = c
    }
    return best
  }

  private discardPending(): void {
    if (this.pending) this.release(this.pending)
    this.pending = null
  }

  private release(cmd: ShellCommand<M>): void {
    for (const m of [cmd.prompt, cmd.start, cmd.output, cmd.end]) if (m && !m.isDisposed) m.dispose()
  }
}

export const lineOf = (c: ShellCommand): number => (c.prompt ?? c.start ?? c.output)?.line ?? -1

/** `850ms`, `12s`, `2m 14s`, `1h 03m`. */
export function elapsedText(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  let s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/**
 * Text for an agent's input: the command, its exit code and the tail of its output (errors land last), every
 * line redacted, the whole ≤ `OUTPUT_PROMPT_MAX`. No trailing newline: it is prefilled, never sent.
 */
export function outputPrompt(cmd: { command: string; exitCode?: number; elapsedMs?: number }, output: string, where: string): string {
  const facts = [`exit ${cmd.exitCode ?? '?'}`, cmd.elapsedMs !== undefined ? elapsedText(cmd.elapsedMs) : ''].filter(Boolean).join(', ')
  const head = `Output of \`${redactLine(cmd.command, 300)}\` (${facts})${where ? ` in ${where}` : ''}:`
  const lines = output.replace(/\r\n?/g, '\n').split('\n').map((l) => redactLine(l, 300))
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  const budget = OUTPUT_PROMPT_MAX - head.length - 10
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const add = lines[i]!.length + 1
    if (size + add > budget) {
      kept.unshift('…')
      break
    }
    kept.unshift(lines[i]!)
    size += add
  }
  return [head, '```', ...kept, '```'].join('\n')
}
