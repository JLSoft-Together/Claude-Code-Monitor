import { mkdtempSync, rmSync, truncateSync, writeFileSync, appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LOG_CHUNK_BYTES, MAX_LOG_BYTES, readLogChunk } from '../src/preview/logRead'

const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-logread-'))
const roots = [dir]
const file = path.join(dir, 'app.log')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('readLogChunk', () => {
  it('reads the tail cut on a line break, then earlier chunks', async () => {
    writeFileSync(file, 'one\ntwo\nthree\nfour\n')
    const tail = await readLogChunk({ path: file, bytes: 12 }, roots)
    expect(tail).toMatchObject({ ok: true, text: 'three\nfour\n', size: 19, end: 19 })
    if (!tail.ok) return
    expect(tail.start).toBe(8)
    const earlier = await readLogChunk({ path: file, end: tail.start, bytes: 6 }, roots)
    expect(earlier).toMatchObject({ ok: true, text: 'two\n', start: 4, end: 8 })
    const first = await readLogChunk({ path: file, end: 4, bytes: 100 }, roots)
    expect(first).toMatchObject({ ok: true, text: 'one\n', start: 0, end: 4 })
  })

  it('follows appended lines and holds back a partial last line', async () => {
    writeFileSync(file, 'a\n')
    appendFileSync(file, 'b\nc')
    const next = await readLogChunk({ path: file, from: 2 }, roots)
    expect(next).toMatchObject({ ok: true, text: 'b\n', start: 2, end: 4 })
    const none = await readLogChunk({ path: file, from: 4 }, roots)
    expect(none).toMatchObject({ ok: true, text: '', start: 4, end: 4 })
    expect((none as { reset?: true }).reset).toBeUndefined()
  })

  it('returns the tail with reset after truncation', async () => {
    writeFileSync(file, 'x\ny\n')
    truncateSync(file, 2)
    expect(await readLogChunk({ path: file, from: 4 }, roots)).toMatchObject({ ok: true, text: 'x\n', start: 0, end: 2, reset: true })
  })

  it('caps the chunk size', async () => {
    writeFileSync(file, `${'z'.repeat(LOG_CHUNK_BYTES + 10)}\n`)
    const r = await readLogChunk({ path: file, bytes: LOG_CHUNK_BYTES * 4 }, roots)
    expect(r.ok && r.end - r.start).toBe(LOG_CHUNK_BYTES)
  })

  it('refuses paths outside the roots, bad input and huge files', async () => {
    expect(await readLogChunk({ path: path.join(os.tmpdir(), 'elsewhere.log') }, roots)).toEqual({ ok: false, error: 'denied' })
    expect(await readLogChunk({ path: 'relative.log' }, roots)).toEqual({ ok: false, error: 'denied' })
    expect(await readLogChunk({ path: 42 }, roots)).toEqual({ ok: false, error: 'denied' })
    expect(await readLogChunk({ path: path.join(dir, '..', path.basename(dir), '..', 'x.log') }, roots)).toEqual({ ok: false, error: 'denied' })
    expect(await readLogChunk({ path: path.join(dir, 'nope.log') }, roots)).toEqual({ ok: false, error: 'missing' })
    const big = path.join(dir, 'big.log')
    writeFileSync(big, '')
    truncateSync(big, MAX_LOG_BYTES + 1)
    expect(await readLogChunk({ path: big }, roots)).toEqual({ ok: false, error: 'too-large' })
  })
})
