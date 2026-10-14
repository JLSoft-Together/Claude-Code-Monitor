import { describe, expect, it } from 'vitest'
import { isHash } from '@ccm/shared'
import { cleanLogQuery, FS, logArgs, parseLog, parseNameStatus, parseRefLines, parseTrack } from '../src/preview/log'

const ROOT = process.platform === 'win32' ? 'C:\repo' : '/repo'

describe('log parsers', () => {
  it('parses NUL-separated log records', () => {
    const rec = (...f: string[]) => f.join(FS)
    const out = [rec('a'.repeat(40), `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'Ann', 'ann@x', '1700000000', 'HEAD -> main, tag: v1', 'Merge x'), rec('b'.repeat(40), '', 'Bo', 'bo@x', '1690000000', '', 'init'), ''].join('\0')
    expect(parseLog(out)).toEqual([
      { hash: 'a'.repeat(40), parents: ['b'.repeat(40), 'c'.repeat(40)], author: 'Ann', email: 'ann@x', time: 1700000000, refs: 'HEAD -> main, tag: v1', subject: 'Merge x' },
      { hash: 'b'.repeat(40), parents: [], author: 'Bo', email: 'bo@x', time: 1690000000, refs: '', subject: 'init' },
    ])
  })

  it('reads upstream tracking', () => {
    expect(parseTrack('ahead 2, behind 1')).toEqual({ ahead: 2, behind: 1, gone: false })
    expect(parseTrack('behind 3')).toEqual({ ahead: 0, behind: 3, gone: false })
    expect(parseTrack('gone')).toEqual({ ahead: 0, behind: 0, gone: true })
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0, gone: false })
  })

  it('groups refs, peels annotated tags and skips remote HEAD', () => {
    const line = (...f: string[]) => f.join(FS)
    const h = (c: string) => c.repeat(40)
    const out = [
      line('refs/heads/main', h('a'), '', 'origin/main', 'ahead 1'),
      line('refs/heads/feature/x', h('b'), '', '', ''),
      line('refs/remotes/origin/HEAD', h('a'), '', '', ''),
      line('refs/remotes/origin/main', h('a'), '', '', ''),
      line('refs/remotes/my/fork/dev', h('c'), '', '', ''),
      line('refs/tags/v1', h('d'), h('e'), '', ''),
      '',
    ].join('\n')
    const r = parseRefLines(out, ['origin', 'my/fork'])
    expect(r.local).toEqual([
      { ref: 'refs/heads/main', name: 'main', hash: h('a'), upstream: 'origin/main', ahead: 1, behind: 0, gone: false },
      { ref: 'refs/heads/feature/x', name: 'feature/x', hash: h('b'), upstream: null, ahead: 0, behind: 0, gone: false },
    ])
    expect(r.remotes).toEqual([
      { name: 'my/fork', refs: [{ ref: 'refs/remotes/my/fork/dev', name: 'my/fork/dev', hash: h('c') }] },
      { name: 'origin', refs: [{ ref: 'refs/remotes/origin/main', name: 'origin/main', hash: h('a') }] },
    ])
    expect(r.tags).toEqual([{ ref: 'refs/tags/v1', name: 'v1', hash: h('e') }])
  })

  it('parses name-status -z incl. renames and copies', () => {
    const out = ['M', 'src/a.ts', 'A', 'new.md', 'D', 'gone.txt', 'R087', 'old.ts', 'renamed.ts', 'C100', 'src/a.ts', 'copy.ts', 'T', 'link', 'X', 'odd', ''].join('\0')
    expect(parseNameStatus(out)).toEqual([
      { path: 'src/a.ts', kind: 'modified' },
      { path: 'new.md', kind: 'added' },
      { path: 'gone.txt', kind: 'deleted' },
      { path: 'renamed.ts', origPath: 'old.ts', kind: 'renamed' },
      { path: 'copy.ts', origPath: 'src/a.ts', kind: 'copied' },
      { path: 'link', kind: 'typechange' },
      { path: 'odd', kind: 'modified' },
    ])
  })

  it('accepts hashes only', () => {
    expect(isHash('abcd')).toBe(true)
    expect(isHash('ABCDEF0123')).toBe(true)
    expect(isHash('abc')).toBe(false)
    expect(isHash('-n')).toBe(false)
    expect(isHash('a'.repeat(41))).toBe(false)
  })
})

describe('log query', () => {
  it('keeps known values only', () => {
    const q = cleanLogQuery({ branch: 'refs/heads/main', author: ' Ann ', since: 10, until: 'x', text: '', regex: 1, matchCase: true, paths: ['src', '../etc', 5], skip: 1000.7 }, ROOT)
    expect(q).toEqual({ branch: 'refs/heads/main', author: 'Ann', since: 10, until: null, text: null, regex: false, matchCase: true, paths: ['src'], skip: 1000 })
  })

  it('rejects branch values that are not refs', () => {
    for (const branch of ['--all', '-n1', 'main', 'refs/heads/a..b', 'refs/heads/x y', 'refs/other/x', 'refs/heads/x.lock']) expect(cleanLogQuery({ branch }, ROOT).branch).toBeNull()
    expect(cleanLogQuery({ branch: 'HEAD' }, ROOT).branch).toBe('HEAD')
    expect(cleanLogQuery({ branch: 'refs/remotes/origin/feature/x' }, ROOT).branch).toBe('refs/remotes/origin/feature/x')
  })

  it('builds git args with page strings behind = or --', () => {
    const base = cleanLogQuery({}, ROOT)
    expect(logArgs(base)).toEqual(['log', '--topo-order', '-z', expect.stringMatching(/^--format=/), '--skip=0', '-n', '501', '--branches', '--remotes', '--tags', 'HEAD', '--'])
    const q = cleanLogQuery({ branch: 'refs/heads/main', author: '-n 1', text: '[fix]', since: 1700000000, paths: ['src/a.ts'] }, ROOT)
    const args = logArgs(q)
    expect(args).toContain('--author=-n 1')
    expect(args).toContain('--grep=[fix]')
    expect(args).toContain('--fixed-strings')
    expect(args).toContain('--regexp-ignore-case')
    expect(args).toContain(`--since=${new Date(1700000000 * 1000).toISOString()}`)
    expect(args.slice(args.indexOf('--'))).toEqual(['--', 'src/a.ts'])
    expect(args[args.indexOf('--') - 1]).toBe('refs/heads/main')
  })

  it('escapes the author when the text is a regex', () => {
    const args = logArgs(cleanLogQuery({ author: 'A.B (x)', text: 'fix|feat', regex: true, matchCase: true }, ROOT))
    expect(args).toContain('--author=A\\.B \\(x\\)')
    expect(args).toContain('--extended-regexp')
    expect(args).not.toContain('--regexp-ignore-case')
  })
})
