import { spawn } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { dirsUp, formatArgs, Formatter, formatterFor, resolveFormatter, runFormatter } from '../src/preview/format'
import type { Spawner } from '../src/run/proc'

const node = (script: string): Spawner => (spec) => spawn(process.execPath, ['-e', script], { cwd: spec.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
const UPPER = "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(s.toUpperCase()))"

describe('formatterFor', () => {
  it('maps extensions to prettier / dart / ktlint', () => {
    for (const f of ['a.ts', 'b.TSX', 'c.vue', 'd.json', 'e.scss', 'f.md', 'g.html', 'h.yml', 'i.mjs']) expect(formatterFor(f)).toBe('prettier')
    expect(formatterFor('lib/main.dart')).toBe('dart')
    expect(formatterFor('A.kt')).toBe('ktlint')
    expect(formatterFor('build.gradle.kts')).toBe('ktlint')
    expect(formatterFor('x.py')).toBeNull()
    expect(formatterFor('Makefile')).toBeNull()
  })
})

describe('resolveFormatter', () => {
  const env = { PATH: '/usr/bin:/opt/bin' }
  it('walks up to the project root, then PATH (posix)', () => {
    const have = new Set(['/repo/node_modules/.bin/prettier', '/opt/bin/prettier', '/usr/bin/dart'])
    const exists = (p: string) => have.has(p)
    expect(dirsUp('/repo/pkg/src/a.ts', '/repo', 'linux')).toEqual(['/repo/pkg/src', '/repo/pkg', '/repo'])
    expect(resolveFormatter('prettier', '/repo/pkg/src/a.ts', '/repo', env, 'linux', exists)).toEqual({ cmd: { file: '/repo/node_modules/.bin/prettier', args: [] }, local: true })
    expect(resolveFormatter('prettier', '/other/a.ts', '/other', env, 'linux', exists)).toEqual({ cmd: { file: '/opt/bin/prettier', args: [] }, local: false })
    expect(resolveFormatter('dart', '/repo/lib/a.dart', '/repo', env, 'linux', exists)).toEqual({ cmd: { file: '/usr/bin/dart', args: [] }, local: false })
    expect(resolveFormatter('ktlint', '/repo/A.kt', '/repo', env, 'linux', exists)).toBeNull()
  })

  it('never looks above the stop folder', () => {
    const exists = (p: string) => p === '/node_modules/.bin/prettier'
    expect(resolveFormatter('prettier', '/repo/a.ts', '/repo', { PATH: '' }, 'linux', exists)).toBeNull()
    expect(dirsUp('/x/a.ts', '/elsewhere', 'linux')).toEqual(['/x'])
  })

  it('wraps a .cmd shim in cmd.exe on Windows, quoting the path', () => {
    const exists = (p: string) => p.toLowerCase() === 'c:\\my repo\\node_modules\\.bin\\prettier.cmd'
    const got = resolveFormatter('prettier', 'C:\\My Repo\\src\\a.ts', 'C:\\my repo', { PATH: '', PATHEXT: '.EXE;.CMD', SystemRoot: 'C:\\Windows' }, 'win32', exists)
    expect(got?.local).toBe(true)
    expect(got?.cmd.verbatim).toBe(true)
    expect(got?.cmd.file).toBe('C:\\Windows\\System32\\cmd.exe')
  })

  it('passes the path for config lookup, content on stdin', () => {
    expect(formatArgs('prettier', '/r/a.ts')).toEqual(['--stdin-filepath', '/r/a.ts'])
    expect(formatArgs('dart', '/r/a.dart')).toEqual(['format', '--stdin-name', '/r/a.dart'])
    expect(formatArgs('ktlint', '/r/A.kt')).toEqual(['--format', '--stdin'])
  })
})

describe('runFormatter', () => {
  const cwd = process.cwd()
  it('returns stdout of a clean exit', async () => {
    expect(await runFormatter('prettier', { file: 'x', args: [] }, 'abc\n', cwd, { spawner: node(UPPER) })).toEqual({ ok: true, text: 'ABC\n' })
  })

  it('reports a failure with the stderr tail', async () => {
    const res = await runFormatter('prettier', { file: 'x', args: [] }, 'a', cwd, { spawner: node("process.stderr.write('SyntaxError: bad');process.exit(2)") })
    expect(res).toEqual({ ok: false, error: 'failed', tool: 'prettier', detail: 'SyntaxError: bad' })
  })

  it('accepts ktlint exit 1 with output, times out a stuck tool', async () => {
    const ok = await runFormatter('ktlint', { file: 'x', args: [] }, 'a', cwd, { spawner: node("process.stdout.write('fun a() {}\\n');process.exit(1)") })
    expect(ok).toEqual({ ok: true, text: 'fun a() {}\n' })
    const slow = await runFormatter('dart', { file: 'x', args: [] }, 'a', cwd, { spawner: node('setTimeout(()=>{},10000)'), timeoutMs: 200 })
    expect(slow).toMatchObject({ ok: false, error: 'timeout' })
  })

  it('Formatter refuses unknown extensions and normalizes CRLF output', async () => {
    const f = new Formatter({ spawner: node("process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('a\\r\\nb\\r\\n'))"), env: () => ({ PATH: path.dirname(process.execPath), PATHEXT: '.EXE;.CMD' }) })
    expect(await f.format(path.join(cwd, 'x.py'), cwd, 'a')).toEqual({ ok: false, error: 'unsupported' })
    const res = await f.format(path.join(cwd, 'x.ts'), cwd, 'a\nb\n')
    if (res.ok) expect(res.text).toBe('a\nb\n')
    else expect(res).toMatchObject({ ok: false, error: 'not-found', tool: 'prettier' })
  })
})
