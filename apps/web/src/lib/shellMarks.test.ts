import { describe, expect, it } from 'vitest'
import { CommandTracker, elapsedText, escapeValue, lineOf, OUTPUT_PROMPT_MAX, outputPrompt, parseMark, unescapeValue, type MarkerLike } from './shellMarks'

class FakeMarker implements MarkerLike {
  isDisposed = false
  constructor(public line: number) {}
  dispose(): void {
    this.isDisposed = true
  }
}

describe('OSC 633 payloads', () => {
  it('parses every mark', () => {
    expect(parseMark('A')).toEqual({ kind: 'promptStart' })
    expect(parseMark('B')).toEqual({ kind: 'commandStart' })
    expect(parseMark('C')).toEqual({ kind: 'executed' })
    expect(parseMark('D;0')).toEqual({ kind: 'finished', exitCode: 0 })
    expect(parseMark('D;127')).toEqual({ kind: 'finished', exitCode: 127 })
    expect(parseMark('D;-1')).toEqual({ kind: 'finished', exitCode: -1 })
    expect(parseMark('D')).toEqual({ kind: 'finished', exitCode: null })
    expect(parseMark('D;oops')).toEqual({ kind: 'finished', exitCode: null })
    expect(parseMark('P;Cwd=/x')).toBeNull()
    expect(parseMark('')).toBeNull()
  })

  it('round-trips the escaping the shell scripts use, nonce after the last field', () => {
    const cmd = 'echo "a;b" \\ done\nnext\x1b'
    const escaped = escapeValue(cmd)
    expect(escaped).not.toMatch(/[;\n\x1b]/)
    expect(escaped).toBe('echo "a\\x3bb" \\x5c done\\x0anext\\x1b')
    expect(unescapeValue(escaped)).toBe(cmd)
    expect(parseMark(`E;${escaped};n0nce`)).toEqual({ kind: 'commandLine', command: cmd, nonce: 'n0nce' })
    expect(parseMark('E;ls -la')).toEqual({ kind: 'commandLine', command: 'ls -la', nonce: null })
    expect(unescapeValue('a\\\\b')).toBe('a\\b')
  })
})

describe('CommandTracker', () => {
  const run = (tr: CommandTracker<FakeMarker>, line: number, text: string, code: number | null, at = 1000, nonceOk = true) => {
    tr.promptStart(new FakeMarker(line))
    tr.commandStart(new FakeMarker(line), 4)
    if (text) tr.commandLine(text, nonceOk)
    tr.executed(new FakeMarker(line + 1), at, () => 'typed fallback')
    return tr.finished(code, new FakeMarker(line + 3), at + 2500, false)
  }

  it('records a command with exit code, duration and trust', () => {
    const tr = new CommandTracker<FakeMarker>()
    const cmd = run(tr, 10, 'npm test', 1)!
    expect(cmd).toMatchObject({ command: 'npm test', exitCode: 1, elapsedMs: 2500, trusted: true })
    expect(tr.done).toHaveLength(1)
    expect(lineOf(cmd)).toBe(10)
  })

  it('falls back to the typed text, untrusted, when no E mark came', () => {
    const tr = new CommandTracker<FakeMarker>()
    expect(run(tr, 0, '', 0)).toMatchObject({ command: 'typed fallback', trusted: false })
  })

  it('drops empty lines, missing exit codes and finishes without an executed mark', () => {
    const tr = new CommandTracker<FakeMarker>()
    const end = new FakeMarker(5)
    tr.promptStart(new FakeMarker(1))
    expect(tr.finished(0, end, 1, false)).toBeNull()
    expect(end.isDisposed).toBe(true)
    expect(run(tr, 2, 'ls', null)).toBeNull()
    const blank = new CommandTracker<FakeMarker>()
    blank.promptStart(new FakeMarker(1))
    blank.executed(new FakeMarker(2), 0, () => '   ')
    expect(blank.finished(0, new FakeMarker(3), 1, false)).toBeNull()
    expect(tr.done).toHaveLength(0)
  })

  it('keeps the newest commands, disposing the markers of trimmed ones', () => {
    const dropped: number[] = []
    const tr = new CommandTracker<FakeMarker>(3, (c) => dropped.push(c.id))
    const first = run(tr, 0, 'a', 0)!
    for (const [i, t] of ['b', 'c', 'd'].entries()) run(tr, (i + 1) * 10, t, 0)
    expect(tr.done.map((c) => c.command)).toEqual(['b', 'c', 'd'])
    expect(dropped).toEqual([first.id])
    expect(first.prompt!.isDisposed && first.output!.isDisposed && first.end!.isDisposed).toBe(true)
    tr.drop(tr.done[0]!)
    tr.drop(first)
    expect(dropped).toHaveLength(2)
    tr.clear()
    expect(tr.done).toHaveLength(0)
  })

  it('has no duration for replayed commands and finds neighbours by line', () => {
    const tr = new CommandTracker<FakeMarker>()
    tr.promptStart(new FakeMarker(0))
    tr.commandLine('x', true)
    tr.executed(new FakeMarker(1), 0, () => '')
    expect(tr.finished(0, new FakeMarker(2), 5, true)?.elapsedMs).toBeUndefined()
    run(tr, 10, 'y', 0)
    run(tr, 20, 'z', 0)
    expect(tr.near(15, -1)?.command).toBe('y')
    expect(tr.near(15, 1)?.command).toBe('z')
    expect(tr.near(10, -1)?.command).toBe('x')
    expect(tr.near(20, 1)).toBeNull()
  })
})

describe('shell mark texts', () => {
  it('formats durations', () => {
    expect(elapsedText(420)).toBe('420ms')
    expect(elapsedText(12_300)).toBe('12s')
    expect(elapsedText(134_000)).toBe('2m 14s')
    expect(elapsedText(3_780_000)).toBe('1h 03m')
  })

  it('builds a redacted, capped agent prompt that keeps the tail', () => {
    const out = outputPrompt({ command: 'curl -H "Authorization: Bearer abcdefghijklmnop1234"', exitCode: 2, elapsedMs: 3000 }, 'ok\nmail me@example.com\n\n', '~/app')
    expect(out).toContain('(exit 2, 3s) in ~/app:')
    expect(out).not.toContain('abcdefghijklmnop1234')
    expect(out).not.toContain('me@example.com')
    expect(out.endsWith('```')).toBe(true)
    const big = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n')
    const capped = outputPrompt({ command: 'build', exitCode: 1 }, big, '')
    expect(capped.length).toBeLessThanOrEqual(OUTPUT_PROMPT_MAX)
    expect(capped).toContain('line 1999')
    expect(capped).not.toContain('line 0\n')
    expect(capped).toContain('…')
  })
})
