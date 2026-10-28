import { describe, expect, it } from 'vitest'
import { appendChunk, filterLines, fromTail, isLogFile, levelCounts, levelsOf, lineLevel, prependChunk, splitChunk } from './logView'

describe('lineLevel', () => {
  it('reads logcat letters', () => {
    expect(lineLevel('01-02 03:04:05.678  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main')).toBe(4)
    expect(lineLevel('2026-01-02 03:04:05.678  1234-1234  MyTag  com.app  W  careful')).toBe(3)
    expect(lineLevel('D/OkHttp( 4321): --> GET')).toBe(1)
    expect(lineLevel('V/Choreographer: frame')).toBe(0)
    expect(lineLevel('A/libc: Fatal signal 11')).toBe(5)
  })

  it('reads level words near the start', () => {
    expect(lineLevel('2026-10-29 10:00:00,123 - root - ERROR - boom')).toBe(4)
    expect(lineLevel('12:00:00.000 [main] INFO  c.e.App - started')).toBe(2)
    expect(lineLevel('[WARN] disk low')).toBe(3)
    expect(lineLevel('TRACE enter')).toBe(0)
    expect(lineLevel('FATAL: out of memory')).toBe(5)
    expect(lineLevel('time=1 level=debug msg=x')).toBe(1)
    expect(lineLevel('[error] lowercase in brackets')).toBe(4)
  })

  it('leaves plain lines and words inside other words', () => {
    expect(lineLevel('hello world')).toBe(-1)
    expect(lineLevel('ERRORS are counted elsewhere')).toBe(-1)
    expect(lineLevel('the information desk')).toBe(-1)
    expect(lineLevel(`${'x'.repeat(300)} ERROR`)).toBe(-1)
  })
})

describe('levelsOf', () => {
  it('gives stack frames the level of their entry', () => {
    const lines = ['E/App: crash', '    at a.b(C.java:1)', 'Caused by: x', '', '\tat d', 'plain', '  indented after plain']
    expect(levelsOf(lines)).toEqual([4, 4, 4, -1, 4, -1, -1])
    expect(levelsOf(['  at x'], 3)).toEqual([3])
  })
})

describe('splitChunk', () => {
  it('splits LF and CRLF, strips a BOM at the file start and reports an open last line', () => {
    expect(splitChunk('\ufeffa\r\nb\r\n', true)).toEqual({ lines: ['a', 'b'], open: false })
    expect(splitChunk('a\nb', false)).toEqual({ lines: ['a', 'b'], open: true })
    expect(splitChunk('\n', false)).toEqual({ lines: [''], open: false })
    expect(splitChunk('', false)).toEqual({ lines: [], open: false })
  })
})

describe('log buffer', () => {
  it('prepends earlier chunks and re-levels continuation lines at the seam', () => {
    let buf = fromTail('  at frame\nI/App: ok\n', 10, 30)
    expect(buf.levels).toEqual([-1, 2])
    buf = prependChunk(buf, 'E/App: crash\n', 0)
    expect(buf.lines).toEqual(['E/App: crash', '  at frame', 'I/App: ok'])
    expect(buf.levels).toEqual([4, 4, 2])
    expect(buf.start).toBe(0)
  })

  it('appends complete lines and joins an open last line', () => {
    let buf = fromTail('W/A: one\nE/A: tw', 0, 16)
    expect(buf.open).toBe(true)
    buf = appendChunk(buf, 'o\n  at x\n', 25)
    expect(buf.lines).toEqual(['W/A: one', 'E/A: two', '  at x'])
    expect(buf.levels).toEqual([3, 4, 4])
    expect(buf).toMatchObject({ end: 25, open: false })
    expect(appendChunk(buf, '', 25)).toMatchObject({ end: 25, lines: buf.lines })
  })
})

describe('filterLines', () => {
  const buf = fromTail('V/A: v\nplain\nW/A: Disk\nE/A: disk full\n', 0, 40)
  it('filters by min level and text', () => {
    expect(filterLines(buf, -1, '')).toBeNull()
    expect(filterLines(buf, 3, '')).toEqual([2, 3])
    expect(filterLines(buf, -1, 'DISK')).toEqual([2, 3])
    expect(filterLines(buf, 4, 'disk')).toEqual([3])
    expect(filterLines(buf, 0, '')).toEqual([0, 2, 3])
  })
  it('counts levels', () => {
    expect(levelCounts(buf.levels)).toEqual([1, 0, 0, 1, 1, 0])
  })
})

describe('isLogFile', () => {
  it('matches .log and logcat*.txt', () => {
    expect(isLogFile('C:\\x\\app.LOG')).toBe(true)
    expect(isLogFile('/a/logcat-2026.txt')).toBe(true)
    expect(isLogFile('/a/Logcat.txt')).toBe(true)
    expect(isLogFile('/a/notes.txt')).toBe(false)
    expect(isLogFile('/a/log.ts')).toBe(false)
  })
})
