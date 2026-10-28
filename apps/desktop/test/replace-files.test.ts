import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { applyReplace, cleanReplace, expandReplacement, matcher, planFile, replaceInLine, type ReplaceRequest } from '../src/preview/replaceFiles'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-replace-')))
const project = path.join(tmp, 'project')
const outside = path.join(tmp, 'outside')
mkdirSync(path.join(project, 'src'), { recursive: true })
mkdirSync(outside, { recursive: true })
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const write = (rel: string, text: string | Buffer, dir = project): string => {
  const p = path.join(dir, rel)
  writeFileSync(p, text)
  return p
}
const q = (s: string, regex = false, caseSensitive = true, word = false) => ({ q: s, regex, caseSensitive, word })

describe('replacement expansion', () => {
  it('expands $1..$9 and $& in regex mode only, other $ sequences stay literal', () => {
    const m = 'key=value'.match(/(\w+)=(\w+)/)!
    expect(expandReplacement('$2:$1 [$&]', m, true)).toBe('value:key [key=value]')
    expect(expandReplacement('$3 $$ $0 $<n> $`', m, true)).toBe('$3 $$ $0 $<n> $`')
    expect(expandReplacement('$1', m, false)).toBe('$1')
  })
  it('replaces every non-empty match in a line', () => {
    const re = matcher(q('(a)(b)?', true))!
    expect(replaceInLine('ab a x', re, '[$1$2]', true)).toEqual({ text: '[ab] [a] x', count: 2 })
    expect(replaceInLine('abc', matcher(q('^', true))!, 'X', true)).toEqual({ text: 'abc', count: 0 })
    expect(replaceInLine('Foo foo', matcher(q('foo', false, false))!, 'bar', false)).toEqual({ text: 'bar bar', count: 2 })
    expect(replaceInLine('foo food', matcher(q('foo', false, true, true))!, 'x', false)).toEqual({ text: 'x food', count: 1 })
  })
})

describe('planFile', () => {
  const re = matcher(q('old'))!
  it('touches only the listed lines and keeps CRLF', () => {
    const res = planFile('old 1\r\nold 2\r\nold 3\r\n', [{ line: 1, text: 'old 1' }, { line: 3, text: 'old 3' }], re, 'new', false)
    expect(res).toEqual({ text: 'new 1\r\nold 2\r\nnew 3\r\n', count: 2 })
  })
  it('skips a file whose line no longer shows the searched text', () => {
    expect(planFile('other\nold\n', [{ line: 1, text: 'old' }], re, 'new', false)).toEqual({ error: 'changed' })
    expect(planFile('old\n', [{ line: 5, text: 'old' }], re, 'new', false)).toEqual({ error: 'changed' })
    expect(planFile('x old y\n', [{ line: 1, text: '…old y' }], re, 'new', false)).toEqual({ text: 'x new y\n', count: 1 })
    expect(planFile('olx\n', [{ line: 1, text: 'olx' }], re, 'new', false)).toEqual({ error: 'no-match' })
  })
})

describe('cleanReplace', () => {
  const base = { query: q('a'), replacement: 'b', files: [{ path: 'src/a.ts', lines: [{ line: 1, text: 'a' }] }] }
  it('accepts relative paths and rejects traversal, absolute paths and newlines', () => {
    expect(cleanReplace(base)).toMatchObject({ replacement: 'b' })
    expect(cleanReplace({ ...base, files: [{ path: '../x', lines: [{ line: 1, text: 'a' }] }] })).toBeNull()
    expect(cleanReplace({ ...base, files: [{ path: path.join(outside, 'x'), lines: [{ line: 1, text: 'a' }] }] })).toBeNull()
    expect(cleanReplace({ ...base, replacement: 'a\nb' })).toBeNull()
    expect(cleanReplace({ ...base, query: { q: '' } })).toBe('bad-query')
    const many = Array.from({ length: 501 }, (_, i) => ({ path: `f${i}.ts`, lines: [{ line: 1, text: 'a' }] }))
    expect(cleanReplace({ ...base, files: many })).toBe('too-many')
  })
})

describe('applyReplace', () => {
  it('writes each file, snapshots it first and reports skipped ones', async () => {
    const a = write('src/a.ts', 'const oldName = 1\nuse(oldName)\n')
    write('src/b.ts', 'oldName here\n')
    const c = write('src/c.ts', 'nothing\n')
    write('evil.ts', 'oldName\n', outside)
    const snaps: string[] = []
    const req: ReplaceRequest = {
      query: q('old(\\w+)', true),
      replacement: 'new$1',
      files: [
        { path: 'src/a.ts', lines: [{ line: 1, text: 'const oldName = 1' }, { line: 2, text: 'use(oldName)' }] },
        { path: 'src/c.ts', lines: [{ line: 1, text: 'oldName' }] },
        { path: 'src/gone.ts', lines: [{ line: 1, text: 'oldName' }] },
      ],
    }
    const res = await applyReplace(project, req, [project], { snapshot: async (real, prev) => void snaps.push(`${path.basename(real)}:${prev.length}`) })
    expect(res).toMatchObject({ ok: true, files: 1, count: 2 })
    if (!res.ok) return
    expect(res.results).toEqual([
      { path: 'src/a.ts', ok: true, count: 2 },
      { path: 'src/c.ts', ok: false, error: 'changed' },
      { path: 'src/gone.ts', ok: false, error: 'missing' },
    ])
    expect(readFileSync(a, 'utf8')).toBe('const newName = 1\nuse(newName)\n')
    expect(readFileSync(c, 'utf8')).toBe('nothing\n')
    expect(readFileSync(path.join(project, 'src/b.ts'), 'utf8')).toBe('oldName here\n')
    expect(snaps).toEqual(['a.ts:31'])
  })

  it('refuses a file outside the searched root and binary files', async () => {
    write('bin.dat', Buffer.from([0x6f, 0x6c, 0x64, 0, 1]))
    const res = await applyReplace(path.join(project, 'src'), { query: q('old'), replacement: 'x', files: [{ path: '../bin.dat', lines: [{ line: 1, text: 'old' }] }] }, [project])
    expect(res.ok && res.results[0]).toMatchObject({ ok: false, error: 'denied' })
    const bin = await applyReplace(project, { query: q('old'), replacement: 'x', files: [{ path: 'bin.dat', lines: [{ line: 1, text: 'old' }] }] }, [project])
    expect(bin.ok && bin.results[0]).toMatchObject({ ok: false, error: 'encoding' })
  })

  it('skips a file touched between the read and the write (mtime moved)', async () => {
    const f = write('src/race.ts', 'old\n')
    const res = await applyReplace(project, { query: q('old'), replacement: 'new', files: [{ path: 'src/race.ts', lines: [{ line: 1, text: 'old' }] }] }, [project], {
      snapshot: async () => {
        writeFileSync(f, 'old\n')
        const t = new Date(Date.now() + 5000)
        utimesSync(f, t, t)
      },
    })
    expect(res.ok && res.results[0]).toMatchObject({ ok: false, error: 'conflict' })
    expect(readFileSync(f, 'utf8')).toBe('old\n')
  })

  it('reports a regex JS cannot compile as unsupported', async () => {
    expect(await applyReplace(project, { query: q('(', true), replacement: '', files: [] }, [project])).toEqual({ ok: false, error: 'unsupported' })
  })
})
