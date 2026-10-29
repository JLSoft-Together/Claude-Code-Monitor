import { describe, expect, it } from 'vitest'
import { bufferLines, parseTerminalProblems, resolveProblemPath, SCAN_MAX_LINES } from './terminalProblems'

const WIN = 'C:\\proj'
const scan = (text: string, cwd: string | null = '/proj') => parseTerminalProblems(text.split('\n'), cwd)

describe('resolveProblemPath', () => {
  it('resolves relative paths against the cwd and normalizes', () => {
    expect(resolveProblemPath('src/a.ts', '/proj')).toBe('/proj/src/a.ts')
    expect(resolveProblemPath('./src/../lib/b.ts', '/proj')).toBe('/proj/lib/b.ts')
    expect(resolveProblemPath('src\\a.ts', WIN)).toBe('C:\\proj\\src\\a.ts')
    expect(resolveProblemPath('src/a.ts', null)).toBeNull()
  })

  it('reads file URLs and absolute paths, skips internals', () => {
    expect(resolveProblemPath('file:///C:/My%20App/a.kt', null)).toBe('C:\\My App\\a.kt')
    expect(resolveProblemPath('file:///home/u/a.kt', null)).toBe('/home/u/a.kt')
    expect(resolveProblemPath('/C:/x/y.ts', null)).toBe('C:\\x\\y.ts')
    expect(resolveProblemPath('node:internal/modules/cjs/loader', '/proj')).toBeNull()
    expect(resolveProblemPath('<anonymous>', '/proj')).toBeNull()
  })
})

describe('parseTerminalProblems', () => {
  it('tsc plain and pretty', () => {
    const r = scan(['src/a.ts(3,7): error TS2322: Type string is not number.', 'src/b.ts:10:2 - warning TS6133: x is unused.', '\x1b[96msrc/c.ts\x1b[0m:1:1 - error TS1005: ; expected.'].join('\n'))
    expect(r.errors).toEqual([
      { file: '/proj/src/a.ts', line: 3, col: 7, message: 'TS2322: Type string is not number.', severity: 'error' },
      { file: '/proj/src/b.ts', line: 10, col: 2, message: 'TS6133: x is unused.', severity: 'warning' },
      { file: '/proj/src/c.ts', line: 1, col: 1, message: 'TS1005: ; expected.', severity: 'error' },
    ])
    expect(r.files).toBe(3)
  })

  it('skips the command line echoed after a shell prompt', () => {
    const r = parseTerminalProblems(
      [
        'PS C:\\proj> echo "src/a.ts(3,7): error TS2322: bad"',
        'src/a.ts(3,7): error TS2322: bad',
        'dev@box:~/proj$ echo src/b.ts:1:1 - error TS1005: x',
        'C:\\proj>echo src/c.ts(1,1): error TS1: y',
        'node -e "console.log(\'src/d.ts(1,1): error TS1: z\')"',
      ],
      WIN,
    )
    expect(r.errors.map((e) => e.file)).toEqual(['C:\\proj\\src\\a.ts'])
  })

  it('eslint stylish groups rows under the file header', () => {
    const r = scan(['/proj/src/a.ts', '   4:10  error    Unexpected any  @typescript-eslint/no-explicit-any', '  12:1   warning  Missing return  func-style', '', '✖ 2 problems', '  3:3 error stray'].join('\n'))
    expect(r.errors.map((e) => [e.file, e.line, e.col, e.severity, e.message])).toEqual([
      ['/proj/src/a.ts', 4, 10, 'error', 'Unexpected any'],
      ['/proj/src/a.ts', 12, 1, 'warning', 'Missing return'],
    ])
  })

  it('dart analyze, bullet and dash layouts, info skipped', () => {
    const r = scan(
      [
        '  error • Undefined name \'x\' • lib/main.dart:3:5 • undefined_identifier',
        '  info • Prefer const • lib/main.dart:4:1 • prefer_const_constructors',
        'warning - lib/a.dart:7:9 - Unused import - unused_import',
        '   info - lib/a.dart:1:1 - Sort imports - directives_ordering',
      ].join('\n'),
    )
    expect(r.errors.map((e) => [e.file, e.line, e.col, e.severity, e.message])).toEqual([
      ['/proj/lib/main.dart', 3, 5, 'error', "Undefined name 'x' (undefined_identifier)"],
      ['/proj/lib/a.dart', 7, 9, 'warning', 'Unused import (unused_import)'],
    ])
  })

  it('kotlin / gradle both layouts', () => {
    const r = scan(['e: file:///C:/proj/app/src/Main.kt:12:5 Unresolved reference: foo', 'w: /proj/app/B.kt: (3, 9): Parameter never used', 'e: app/C.kt: (1, 1): Expecting a top level declaration'].join('\n'))
    expect(r.errors.map((e) => [e.file, e.line, e.col, e.severity])).toEqual([
      ['C:\\proj\\app\\src\\Main.kt', 12, 5, 'error'],
      ['/proj/app/B.kt', 3, 9, 'warning'],
      ['/proj/app/C.kt', 1, 1, 'error'],
    ])
    expect(r.errors[0]!.message).toBe('Unresolved reference: foo')
  })

  it('gcc style, pytest and vitest', () => {
    const r = scan(
      [
        'main.c:5:3: error: expected ; before }',
        'C:\\proj\\x.go:2:1: warning: unused',
        'tests/test_a.py:14: AssertionError',
        'AssertionError: expected 1 to be 2',
        ' ❯ src/a.test.ts:9:17',
      ].join('\n'),
    )
    expect(r.errors.map((e) => [e.file, e.line, e.col, e.severity, e.message])).toEqual([
      ['/proj/main.c', 5, 3, 'error', 'expected ; before }'],
      ['C:\\proj\\x.go', 2, 1, 'warning', 'unused'],
      ['/proj/tests/test_a.py', 14, 1, 'error', 'AssertionError'],
      ['/proj/src/a.test.ts', 9, 17, 'error', 'AssertionError: expected 1 to be 2'],
    ])
  })

  it('node stack: first own frame only, internals and node_modules skipped', () => {
    const r = scan(
      [
        'TypeError: Cannot read properties of undefined (reading \'x\')',
        '    at Object.<anonymous> (/proj/node_modules/lib/index.js:3:9)',
        '    at run (/proj/src/server.js:42:13)',
        '    at main (/proj/src/index.js:5:1)',
        '    at node:internal/main/run_main_module:28:49',
        '',
        'Error: boom',
        '    at C:\\proj\\cli.mjs:7:3',
      ].join('\n'),
    )
    expect(r.errors.map((e) => [e.file, e.line, e.col, e.message])).toEqual([
      ['/proj/src/server.js', 42, 13, "TypeError: Cannot read properties of undefined (reading 'x')"],
      ['C:\\proj\\cli.mjs', 7, 3, 'Error: boom'],
    ])
  })

  it('ignores plain output, dedupes, needs a cwd for relative paths', () => {
    expect(scan('npm run build\n> vite build\n✓ 120 modules transformed.\nhttp://localhost:5173/').errors).toEqual([])
    expect(scan('src/a.ts(1,1): error TS1: x\nsrc/a.ts(1,1): error TS1: x').errors).toHaveLength(1)
    expect(scan('src/a.ts(1,1): error TS1: x', null).errors).toEqual([])
  })

  it('reads only the last lines', () => {
    const lines = ['old.ts(1,1): error TS1: x', ...Array.from({ length: SCAN_MAX_LINES }, () => 'noise')]
    expect(parseTerminalProblems(lines, '/proj').errors).toEqual([])
  })
})

describe('bufferLines', () => {
  it('joins soft-wrapped rows', () => {
    const rows = [
      { text: 'src/very/long/pa', wrapped: false },
      { text: 'th.ts(3,1): error TS1: x', wrapped: true },
      { text: '$ ', wrapped: false },
    ]
    const buf = { length: rows.length, getLine: (i: number) => rows[i] && { isWrapped: rows[i]!.wrapped, translateToString: () => rows[i]!.text } }
    expect(bufferLines(buf)).toEqual(['src/very/long/path.ts(3,1): error TS1: x', '$ '])
    expect(bufferLines(buf, 1)).toEqual(['$ '])
  })
})
