import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diff, discardFile, discardHunk, hunkPatchFor, newFileDiff, parseNumstat, parseStatusV2, safeRepoPath, status, toplevel } from '../src/preview/changes'
import { MAX_CLIPBOARD_IMAGE_BYTES, parsePngDataUrl, writeClipboardImage, writeClipboardImageFile } from '../src/preview/clipboardImage'
import { FileListCache, listFiles, parseLsFiles, walkFiles } from '../src/preview/listFiles'
import { findGit } from '../src/pty/git'

const git = findGit()
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-changes-'))
const repo = path.join(tmp, 'repo')
const run = (...args: string[]): string => execFileSync(git!, ['-C', repo, ...args], { encoding: 'utf8' })

describe('parsers', () => {
  it('parses porcelain v2 records', () => {
    const out = [
      '# branch.oid 0123456789abcdef',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 aaa bbb src/a b.ts',
      '1 A. N... 000000 100644 100644 000 ccc new.ts',
      '1 .D N... 100644 100644 000000 ddd ddd gone.ts',
      '2 R. N... 100644 100644 100644 eee eee R100 to.ts',
      'from.ts',
      'u UU N... 100644 100644 100644 100644 f1 f2 f3 clash.ts',
      '? notes.md',
      '! ignored.log',
      '',
    ].join('\0')
    const { branch, entries } = parseStatusV2(out)
    expect(branch).toBe('main')
    expect(entries.map((e) => [e.path, e.kind, e.staged])).toEqual([
      ['src/a b.ts', 'modified', false],
      ['new.ts', 'added', true],
      ['gone.ts', 'deleted', false],
      ['to.ts', 'renamed', true],
      ['clash.ts', 'conflict', false],
      ['notes.md', 'untracked', false],
    ])
    expect(entries[3]!.origPath).toBe('from.ts')
  })

  it('parses numstat incl. renames and binaries', () => {
    const map = parseNumstat(['3\t1\ta.ts', '-\t-\timg.png', '2\t0\t', 'old.ts', 'new.ts', ''].join('\0'))
    expect(map.get('a.ts')).toEqual({ added: 3, removed: 1, binary: false })
    expect(map.get('img.png')).toEqual({ binary: true })
    expect(map.get('new.ts')).toMatchObject({ added: 2, removed: 0 })
  })

  it('keeps repo paths inside the root', () => {
    const root = path.resolve(tmp, 'r')
    expect(safeRepoPath(root, 'src/a.ts')?.abs).toBe(path.join(root, 'src', 'a.ts'))
    expect(safeRepoPath(root, '../x')).toBeNull()
    expect(safeRepoPath(root, 'a/../../x')).toBeNull()
    expect(safeRepoPath(root, path.join(root, 'a.ts'))).toBeNull()
    expect(safeRepoPath(root, 'C:/Windows/win.ini')).toBeNull()
    expect(safeRepoPath(root, '')).toBeNull()
    expect(safeRepoPath(root, '.')).toBeNull()
    expect(safeRepoPath(root, 42)).toBeNull()
  })

  it('re-heads one hunk and rejects malformed ones', () => {
    const page = ['diff --git a/evil b/evil', '--- a/evil', '+++ b/evil', '@@ -1,2 +1,2 @@', ' a', '-b', '+c', ''].join('\n')
    expect(hunkPatchFor('ok.ts', page)).toBe(['diff --git a/ok.ts b/ok.ts', '--- a/ok.ts', '+++ b/ok.ts', '@@ -1,2 +1,2 @@', ' a', '-b', '+c', ''].join('\n'))
    expect(hunkPatchFor('ok.ts', '@@ -1,2 +1,2 @@\n a\n-b\n')).toBeNull()
    expect(hunkPatchFor('ok.ts', '@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,1 +9,1 @@\n-x\n+y\n')).toBeNull()
    expect(hunkPatchFor('ok.ts', 'no hunk')).toBeNull()
    expect(hunkPatchFor('ok.ts', 7)).toBeNull()
  })

  it('builds a new-file diff', () => {
    expect(newFileDiff('n.txt', 'a\nb\n')).toBe('diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n')
    expect(newFileDiff('n.txt', 'a')).toContain('+a\n\\ No newline at end of file\n')
  })
})

describe.skipIf(!git)('git repo', () => {
  const trashed: string[] = []
  const trash = async (p: string): Promise<void> => {
    trashed.push(p)
    renameSync(p, path.join(tmp, `trash-${trashed.length}`))
  }

  beforeAll(() => {
    mkdirSync(path.join(repo, 'src'), { recursive: true })
    execFileSync(git!, ['init', '-q', repo])
    run('config', 'user.email', 't@t')
    run('config', 'user.name', 't')
    run('config', 'core.autocrlf', 'false')
    writeFileSync(path.join(repo, 'src', 'a.ts'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
    writeFileSync(path.join(repo, 'keep.txt'), 'keep\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
  })

  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('finds the toplevel from a sub-folder', async () => {
    const top = await toplevel(path.join(repo, 'src'))
    expect('root' in top && path.resolve(top.root).toLowerCase()).toBe(path.resolve(repo).toLowerCase())
    expect(await toplevel(tmp)).toEqual({ error: 'not-repo' })
  })

  it('lists status with counts, diffs and discards one hunk', async () => {
    const file = path.join(repo, 'src', 'a.ts')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines[1] = 'changed 2'
    lines[24] = 'changed 25'
    writeFileSync(file, lines.join('\n'))
    writeFileSync(path.join(repo, 'new.md'), 'x\ny\n')

    const st = await status(repo)
    expect(st.ok).toBe(true)
    if (!st.ok) return
    const a = st.entries.find((e) => e.path === 'src/a.ts')!
    expect(a).toMatchObject({ kind: 'modified', added: 2, removed: 2 })
    expect(st.entries.find((e) => e.path === 'new.md')).toMatchObject({ kind: 'untracked', added: 2 })

    const d = await diff(repo, 'src/a.ts')
    expect(d.ok && d.text.match(/^@@ /gm)?.length).toBe(2)
    const nd = await diff(repo, 'new.md')
    expect(nd.ok && nd.untracked && nd.text).toContain('+x')

    const second = d.ok ? d.text.slice(d.text.lastIndexOf('\n@@ ') + 1) : ''
    expect(await discardHunk(repo, 'src/a.ts', second)).toEqual({ ok: true })
    const after = readFileSync(file, 'utf8')
    expect(after).toContain('changed 2')
    expect(after).toContain('line 25')
    expect((await discardHunk(repo, 'src/a.ts', second)).ok).toBe(false)
    expect((await discardHunk(repo, 'new.md', second)).ok).toBe(false)
  })

  it('discards tracked files via restore and untracked via trash', async () => {
    expect(await discardFile(repo, 'src/a.ts', { trash })).toEqual({ ok: true })
    expect(readFileSync(path.join(repo, 'src', 'a.ts'), 'utf8')).toContain('line 2\n')
    expect(await discardFile(repo, 'new.md', { trash })).toEqual({ ok: true })
    expect(existsSync(path.join(repo, 'new.md'))).toBe(false)
    expect(trashed.at(-1)).toBe(path.join(repo, 'new.md'))
    expect(await discardFile(repo, '../outside', { trash })).toEqual({ ok: false, error: 'denied' })
    expect(await discardFile(repo, 'keep.txt', { trash })).toEqual({ ok: false, error: 'stale' })
  })

  it('discards a staged new file to the trash and unstages it', async () => {
    writeFileSync(path.join(repo, 'added.ts'), 'a\n')
    run('add', 'added.ts')
    expect(await discardFile(repo, 'added.ts', { trash })).toEqual({ ok: true })
    expect(existsSync(path.join(repo, 'added.ts'))).toBe(false)
    expect(run('status', '--porcelain')).toBe('')
  })

  it('lists files via git and walk, cached per root', async () => {
    writeFileSync(path.join(repo, '.gitignore'), 'skip/\n')
    mkdirSync(path.join(repo, 'skip'), { recursive: true })
    writeFileSync(path.join(repo, 'skip', 'x.ts'), '')
    const list = await listFiles(repo)
    expect(list.source).toBe('git')
    expect(list.files).toContain('src/a.ts')
    expect(list.files).toContain('.gitignore')
    expect(list.files).not.toContain('skip/x.ts')

    mkdirSync(path.join(tmp, 'plain', 'node_modules', 'p'), { recursive: true })
    writeFileSync(path.join(tmp, 'plain', 'a.txt'), '')
    writeFileSync(path.join(tmp, 'plain', 'node_modules', 'p', 'i.js'), '')
    expect((await walkFiles(path.join(tmp, 'plain'))).files).toEqual(['a.txt'])
    expect(await walkFiles(path.join(tmp, 'plain'), 0)).toEqual({ files: [], truncated: true })

    let calls = 0
    const cache = new FileListCache(async (root) => ({ root, files: [String(++calls)], truncated: false, source: 'walk' }))
    expect((await cache.get(repo)).files).toEqual(['1'])
    expect((await cache.get(repo)).files).toEqual(['1'])
    cache.invalidate(path.join(repo, 'src'))
    expect((await cache.get(repo)).files).toEqual(['2'])
  })
})

describe('ls-files + clipboard', () => {
  it('dedupes and caps ls-files output', () => {
    expect(parseLsFiles('a\0b\0a\0c\0', 2)).toEqual({ files: ['a', 'b'], truncated: true })
    expect(parseLsFiles('a\0b\0')).toEqual({ files: ['a', 'b'], truncated: false })
  })

  it('accepts only real PNG data URLs under the cap', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const url = `data:image/png;base64,${png.toString('base64')}`
    expect(parsePngDataUrl(url)?.length).toBe(png.length)
    expect(parsePngDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`)).toBeNull()
    expect(parsePngDataUrl(`data:image/png;base64,${Buffer.from('GIF89a').toString('base64')}`)).toBeNull()
    expect(parsePngDataUrl('data:image/png;base64,***')).toBeNull()
    expect(parsePngDataUrl(url, 4)).toBeNull()
    expect(MAX_CLIPBOARD_IMAGE_BYTES).toBe(20 * 1024 * 1024)

    const written: Buffer[] = []
    const deps = { createFromDataURL: () => ({ isEmpty: () => false, toPNG: () => png }), createFromPath: () => ({ isEmpty: () => true, toPNG: () => png }), writePng: async (b: Buffer) => void written.push(b) }
    expect(await writeClipboardImage(url, deps)).toBe(true)
    expect(await writeClipboardImage('data:text/plain,hi', deps)).toBe(false)
    expect(await writeClipboardImage(url, { ...deps, createFromDataURL: () => ({ isEmpty: () => true, toPNG: () => png }) })).toBe(false)
    expect(written).toEqual([png])
  })

  it('clipboard image file: absolute image files only, decoded before writing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-clip-'))
    try {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
      const file = path.join(dir, 'shot.png')
      writeFileSync(file, png)
      writeFileSync(path.join(dir, 'notes.txt'), 'hi')
      const written: Buffer[] = []
      const image = (empty: boolean) => ({ isEmpty: () => empty, toPNG: () => png })
      const deps = { createFromDataURL: () => image(false), createFromPath: () => image(false), writePng: async (b: Buffer) => void written.push(b) }
      expect(await writeClipboardImageFile(file, deps)).toBe(true)
      expect(await writeClipboardImageFile('shot.png', deps)).toBe(false)
      expect(await writeClipboardImageFile(path.join(dir, 'notes.txt'), deps)).toBe(false)
      expect(await writeClipboardImageFile(path.join(dir, 'missing.png'), deps)).toBe(false)
      expect(await writeClipboardImageFile(dir + path.sep + 'x.gif', deps)).toBe(false)
      expect(await writeClipboardImageFile(file, { ...deps, createFromPath: () => image(true) })).toBe(false)
      expect(written).toEqual([png])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
