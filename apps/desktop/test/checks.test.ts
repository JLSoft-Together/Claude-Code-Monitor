import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanCheck, parseCheckOutput } from '../src/preview/checks'

const dir = path.resolve('/repo')

describe('parseCheckOutput', () => {
  it('reads tsc, vue-tsc pretty and dart analyze lines', () => {
    const out = [
      'src/a.ts(3,5): error TS2304: Cannot find name \'x\'.',
      '\x1b[96msrc/b.vue\x1b[0m:10:2 - error TS2339: Property y does not exist.',
      '  error • Undefined name \'z\' • lib/main.dart:7:3 • undefined_identifier',
      '   info • Prefer const • lib/main.dart:9:1 • prefer_const',
    ].join('\n')
    const { errors } = parseCheckOutput(out, dir)
    expect(errors.map((e) => [path.relative(dir, e.file).replace(/\\/g, '/'), e.line, e.col, e.severity])).toEqual([
      ['src/a.ts', 3, 5, 'error'],
      ['src/b.vue', 10, 2, 'error'],
      ['lib/main.dart', 7, 3, 'error'],
    ])
  })

  it('reads ESLint stylish blocks and Kotlin errors', () => {
    const file = path.join(dir, 'src', 'c.ts')
    const out = [file, '  4:1  error  Unexpected var  no-var', '  5:2  warning  Missing semicolon  semi', '', `e: file:///${file.replace(/\\/g, '/')}:12:8 Unresolved reference: foo`].join('\n')
    const { errors } = parseCheckOutput(out, dir)
    expect(errors.map((e) => [e.line, e.severity, e.message])).toEqual([
      [4, 'error', 'Unexpected var'],
      [5, 'warning', 'Missing semicolon'],
      [12, 'error', 'Unresolved reference: foo'],
    ])
  })

  it('pairs a Vitest assertion with its location', () => {
    const { errors } = parseCheckOutput('AssertionError: expected 1 to be 2\n ❯ test/x.test.ts:8:14\n', dir)
    expect(errors).toEqual([expect.objectContaining({ line: 8, col: 14, message: 'expected 1 to be 2' })])
  })
})

describe('cleanCheck', () => {
  it('needs a source and a name', () => {
    expect(cleanCheck({ source: 'npm', name: 'typecheck' })).toEqual({ source: 'npm', name: 'typecheck' })
    expect(cleanCheck({ source: 'npm' })).toBeNull()
  })
})
