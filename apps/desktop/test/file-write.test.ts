import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { decodeUtf8, eolOf, readFileForView } from '../src/preview/files'
import { encodeForDisk, MAX_WRITE_BYTES, writeTextFile } from '../src/preview/fileWrite'
import { cleanDirty } from '../src/editors'
import { cleanText, isLayoutTarget } from '../src/layout/ipc'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-write-')))
const project = path.join(tmp, 'project')
const outside = path.join(tmp, 'outside')
mkdirSync(project, { recursive: true })
mkdirSync(outside, { recursive: true })
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const file = (name: string, content: string | Buffer, dir = project): string => {
  const p = path.join(dir, name)
  writeFileSync(p, content)
  return p
}
const mtime = (p: string): number => statSync(p).mtimeMs
const roots = [project]

describe('eol / utf-8 helpers', () => {
  it('finds the dominant line break', () => {
    expect(eolOf('a\r\nb\r\nc\n')).toBe('crlf')
    expect(eolOf('a\nb\nc\r\n')).toBe('lf')
    expect(eolOf('a\rb\rc')).toBe('cr')
    expect(eolOf('single line')).toBe('lf')
  })
  it('decodes strict UTF-8 without the BOM and rejects invalid bytes', () => {
    expect(decodeUtf8(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi')
    expect(decodeUtf8(Buffer.from([0x68, 0xff, 0x69]))).toBeNull()
  })
  it('encodes editor text with the file EOL and BOM', () => {
    expect(encodeForDisk('a\nb', 'crlf', false).toString('utf8')).toBe('a\r\nb')
    expect([...encodeForDisk('x', 'lf', true)]).toEqual([0xef, 0xbb, 0xbf, 0x78])
    expect(encodeForDisk('a\r\nb\rc', 'lf', false).toString('utf8')).toBe('a\nb\nc')
  })
  it('readFileForView reports BOM, EOL and invalid UTF-8', async () => {
    const bom = file('bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n')]))
    const view = await readFileForView(bom, roots)
    expect(view).toMatchObject({ kind: 'text', text: 'one\r\ntwo\r\n', bom: true, eol: 'crlf' })
    expect(view.invalidUtf8).toBeUndefined()
    const latin = file('latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    expect(await readFileForView(latin, roots)).toMatchObject({ kind: 'text', invalidUtf8: true })
  })
})

describe('writeTextFile', () => {
  it('writes atomically, keeps CRLF and the BOM, returns the new mtime', async () => {
    const p = file('crlf.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\n')]))
    const res = await writeTextFile({ path: p, text: 'a\nB\nc\n', expectedMtime: mtime(p) }, roots)
    expect(res).toMatchObject({ ok: true, path: p })
    const bytes = readFileSync(p)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString('utf8')).toBe('a\r\nB\r\nc\r\n')
    expect(res.ok && res.mtimeMs).toBe(mtime(p))
    expect(readdirSync(project).filter((n) => n.includes('.ccm-tmp'))).toEqual([])
  })

  it('keeps LF files LF', async () => {
    const p = file('lf.txt', 'x\ny\n')
    await writeTextFile({ path: p, text: 'x\r\nz\r\n' }, roots)
    expect(readFileSync(p, 'utf8')).toBe('x\nz\n')
  })

  it('refuses a stale mtime (conflict) and leaves the file alone', async () => {
    const p = file('conflict.txt', 'disk')
    const res = await writeTextFile({ path: p, text: 'mine', expectedMtime: mtime(p) - 5000 }, roots)
    expect(res).toEqual({ ok: false, error: 'conflict' })
    expect(readFileSync(p, 'utf8')).toBe('disk')
  })

  it('refuses paths outside the allowed roots, relative paths and missing files', async () => {
    const secret = file('secret.txt', 's', outside)
    expect(await writeTextFile({ path: secret, text: 'x' }, roots)).toEqual({ ok: false, error: 'denied' })
    expect(await writeTextFile({ path: 'relative.txt', text: 'x' }, roots)).toEqual({ ok: false, error: 'denied' })
    expect(await writeTextFile({ path: path.join(project, 'nope.txt'), text: 'x' }, roots)).toEqual({ ok: false, error: 'missing' })
    expect(await writeTextFile({ path: path.join(project, 'x.txt') }, roots)).toEqual({ ok: false, error: 'denied' })
    expect(readFileSync(secret, 'utf8')).toBe('s')
  })

  it('refuses a symlink that escapes the root', async () => {
    const target = file('target.txt', 'outside', outside)
    const link = path.join(project, 'link.txt')
    try {
      symlinkSync(target, link, 'file')
    } catch {
      return // file symlinks need a privilege on Windows
    }
    expect(await writeTextFile({ path: link, text: 'pwned' }, roots)).toEqual({ ok: false, error: 'denied' })
    expect(readFileSync(target, 'utf8')).toBe('outside')
  })

  it('refuses binary / non UTF-8 files and oversized text', async () => {
    const bin = file('bin.dat', Buffer.from([0x61, 0x00, 0x62]))
    expect(await writeTextFile({ path: bin, text: 'a' }, roots)).toEqual({ ok: false, error: 'encoding' })
    const latin = file('latin2.txt', Buffer.from([0xe9]))
    expect(await writeTextFile({ path: latin, text: 'a' }, roots)).toEqual({ ok: false, error: 'encoding' })
    const p = file('big.txt', 'x')
    expect(await writeTextFile({ path: p, text: 'é'.repeat(MAX_WRITE_BYTES / 2 + 1) }, roots)).toEqual({ ok: false, error: 'too-large' })
  })

  it('retries a busy rename (Windows EPERM), then reports busy and removes the temp file', async () => {
    const p = file('busy.txt', 'old')
    let calls = 0
    const flaky = async (from: string, to: string): Promise<void> => {
      if (++calls < 3) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      const { rename } = await import('node:fs/promises')
      await rename(from, to)
    }
    expect(await writeTextFile({ path: p, text: 'new' }, roots, { rename: flaky, sleep: async () => undefined })).toMatchObject({ ok: true })
    expect(readFileSync(p, 'utf8')).toBe('new')

    const stuck = async (): Promise<void> => {
      throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
    }
    expect(await writeTextFile({ path: p, text: 'newer' }, roots, { rename: stuck, sleep: async () => undefined })).toEqual({ ok: false, error: 'busy' })
    expect(readFileSync(p, 'utf8')).toBe('new')
    expect(readdirSync(project).filter((n) => n.includes('.ccm-tmp'))).toEqual([])
  })
})

describe('layout targets (v42 loose layouts + buffer text)', () => {
  const layout = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" />`

  it('accepts a loose layout anywhere, by root element', async () => {
    const p = file('bg_native_ad_cta.xml', layout)
    expect(await isLayoutTarget(p, null)).toBe(true)
    expect(await isLayoutTarget(p, '<shape xmlns:android="http://schemas.android.com/apk/res/android"/>')).toBe(false)
  })

  it('keeps res/layout by path and refuses other res folders, drawables and plain XML', async () => {
    mkdirSync(path.join(project, 'res', 'layout'), { recursive: true })
    mkdirSync(path.join(project, 'res', 'menu'), { recursive: true })
    mkdirSync(path.join(project, 'res', 'drawable'), { recursive: true })
    expect(await isLayoutTarget(file(path.join('res', 'layout', 'a.xml'), '<merge/>'), null)).toBe(true)
    expect(await isLayoutTarget(file(path.join('res', 'menu', 'm.xml'), layout), null)).toBe(false)
    expect(await isLayoutTarget(file(path.join('res', 'drawable', 'd.xml'), layout), null)).toBe(false)
    expect(await isLayoutTarget(file('log4j2.xml', '<Configuration status="warn"><Appenders/></Configuration>'), null)).toBe(false)
    expect(await isLayoutTarget(file('notes.txt', layout), null)).toBe(false)
  })

  it('cleans buffer text', () => {
    expect(cleanText(undefined)).toBeUndefined()
    expect(cleanText('<x/>')).toBe('<x/>')
    expect(cleanText(42)).toBeNull()
    expect(cleanText('x'.repeat(1024 * 1024 + 1))).toBeNull()
  })
})

describe('editor dirty list (quit dialog)', () => {
  it('keeps only well-formed entries', () => {
    expect(cleanDirty([{ name: 'a.ts', path: '/p/a.ts' }, { name: 1 }, null, 'x'])).toEqual([{ name: 'a.ts', path: '/p/a.ts' }])
    expect(cleanDirty('nope')).toEqual([])
  })
})
