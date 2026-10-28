import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findGit } from '../src/pty/git'
import { headImage, imageMime, MAX_IMAGE_BYTES } from '../src/preview/gitImage'

const git = findGit()
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0xff, 0x00, 0x80])

describe('imageMime', () => {
  it('maps image extensions only', () => {
    expect(imageMime('a/b.PNG')).toBe('image/png')
    expect(imageMime('x.jpeg')).toBe('image/jpeg')
    expect(imageMime('icon.svg')).toBe('image/svg+xml')
    expect(imageMime('x.bmp')).toBe('image/bmp')
    expect(imageMime('notes.txt')).toBeNull()
    expect(imageMime('png')).toBeNull()
  })
})

describe.skipIf(!git)('headImage', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'ccm-gitimg-'))
  const run = (...args: string[]) => execFileSync(git!, args, { cwd: repo, encoding: 'utf8' })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it('reads the committed bytes, not the working copy', async () => {
    run('init', '-q')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 'Tess')
    expect(await headImage(repo, 'img/a.png')).toEqual({ ok: false, error: 'missing' })
    mkdirSync(path.join(repo, 'img'))
    writeFileSync(path.join(repo, 'img', 'a.png'), PNG)
    writeFileSync(path.join(repo, 'b.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    run('add', '.')
    run('commit', '-q', '-m', 'images')
    writeFileSync(path.join(repo, 'img', 'a.png'), Buffer.from('changed'))
    const r = await headImage(repo, 'img/a.png')
    expect(r).toEqual({ ok: true, dataUrl: `data:image/png;base64,${PNG.toString('base64')}`, size: PNG.length })
    expect(await headImage(repo, 'b.svg')).toMatchObject({ ok: true, dataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/) })
  })

  it('refuses paths outside the repo, other types and missing files', async () => {
    expect(await headImage(repo, '../x.png')).toEqual({ ok: false, error: 'denied' })
    expect(await headImage(repo, path.join(repo, 'img', 'a.png'))).toEqual({ ok: false, error: 'denied' })
    expect(await headImage(repo, 42)).toEqual({ ok: false, error: 'denied' })
    expect(await headImage(repo, 'readme.md')).toEqual({ ok: false, error: 'unsupported' })
    expect(await headImage(repo, 'nope.png')).toEqual({ ok: false, error: 'missing' })
    expect(await headImage(repo, 'img.png')).toEqual({ ok: false, error: 'missing' })
  })

  it('caps the size', async () => {
    writeFileSync(path.join(repo, 'big.bmp'), Buffer.alloc(MAX_IMAGE_BYTES + 1, 1))
    run('add', 'big.bmp')
    run('commit', '-q', '-m', 'big')
    expect(await headImage(repo, 'big.bmp')).toEqual({ ok: false, error: 'too-large' })
  })
})
