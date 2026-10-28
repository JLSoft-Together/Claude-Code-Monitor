import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { NOTES_MAX_BYTES, NotesStore } from '../src/preview/notes'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-notes-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const root = path.join(tmp, 'proj')

describe('NotesStore', () => {
  it('names the file by the sha1 of the normalized root, inside dataDir/notes', () => {
    const store = new NotesStore(tmp)
    const file = store.fileOf(root)
    expect(path.dirname(file)).toBe(path.join(tmp, 'notes'))
    expect(path.basename(file)).toMatch(/^[0-9a-f]{40}\.md$/)
    expect(store.fileOf(`${root}${path.sep}`)).toBe(file)
    if (process.platform === 'win32') expect(store.fileOf(root.toUpperCase())).toBe(file)
  })

  it('reads empty before the first write, then round-trips', async () => {
    const store = new NotesStore(tmp)
    expect(await store.read(root)).toEqual({ ok: true, text: '', mtimeMs: null })
    const w = await store.write(root, '# Notes\n@src/a.ts:3\n')
    expect(w.ok).toBe(true)
    const r = await store.read(root)
    expect(r).toMatchObject({ ok: true, text: '# Notes\n@src/a.ts:3\n' })
    expect(readdirSync(path.join(tmp, 'notes')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('keeps the last of queued writes and removes the file on empty text', async () => {
    const store = new NotesStore(tmp)
    await Promise.all([store.write(root, 'a'), store.write(root, 'b'), store.write(root, 'c')])
    expect(readFileSync(store.fileOf(root), 'utf8')).toBe('c')
    expect(await store.write(root, '')).toEqual({ ok: true, mtimeMs: null })
    expect(existsSync(store.fileOf(root))).toBe(false)
  })

  it('refuses non-text and oversized notes', async () => {
    const store = new NotesStore(tmp)
    expect(await store.write(root, 42)).toEqual({ ok: false, error: 'denied' })
    expect(await store.write(root, 'x'.repeat(NOTES_MAX_BYTES + 1))).toEqual({ ok: false, error: 'too-large' })
    writeFileSync(store.fileOf(root), 'y'.repeat(NOTES_MAX_BYTES + 1))
    expect(await store.read(root)).toEqual({ ok: false, error: 'too-large' })
  })

  it('retries a busy rename, then gives up without leaving a temp file', async () => {
    let calls = 0
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    const flaky = new NotesStore(tmp, { rename: async (a, b) => (++calls < 3 ? Promise.reject(busy) : (await import('node:fs/promises')).rename(a, b)), sleep: async () => {} })
    expect((await flaky.write(root, 'ok')).ok).toBe(true)
    expect(calls).toBe(3)
    const stuck = new NotesStore(tmp, { rename: () => Promise.reject(busy), sleep: async () => {} })
    expect(await stuck.write(root, 'no')).toEqual({ ok: false, error: 'failed' })
    expect(readdirSync(path.join(tmp, 'notes')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
