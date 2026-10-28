import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isVersionId, LH_KEEP, LH_MAX_AGE_MS, LH_MAX_BYTES, LocalHistory } from '../src/preview/localHistory'
import { writeTextFile } from '../src/preview/fileWrite'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-lh-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const file = path.join(tmp, 'proj', 'a.ts')

describe('LocalHistory', () => {
  it('keeps versions per file under dataDir/history/<sha1>', () => {
    const lh = new LocalHistory(path.join(tmp, 'd0'))
    const dir = lh.dirOf(file)
    expect(path.dirname(dir)).toBe(path.join(tmp, 'd0', 'history'))
    expect(path.basename(dir)).toMatch(/^[0-9a-f]{40}$/)
    if (process.platform === 'win32') expect(lh.dirOf(file.toUpperCase())).toBe(dir)
  })

  it('records, lists newest first and reads back', async () => {
    let now = 1_800_000_000_000
    const lh = new LocalHistory(path.join(tmp, 'd1'), { now: () => now })
    await lh.record(file, 'one')
    now += 1000
    await lh.record(file, 'two\r\n')
    await lh.record(file, 'three')
    const res = await lh.list(file)
    if (!res.ok) throw new Error('list failed')
    expect(res.versions.map((v) => v.time)).toEqual([now, now, now - 1000])
    expect(res.versions[0]!.id).toBe(`${now}-1`)
    const read = await lh.read(file, res.versions[1]!.id)
    expect(read).toEqual({ ok: true, text: 'two\r\n', time: now })
  })

  it('prunes past 50 versions and 7 days on write', async () => {
    let now = 1_800_000_000_000
    const lh = new LocalHistory(path.join(tmp, 'd2'), { now: () => now })
    for (let i = 0; i < LH_KEEP + 5; i++) {
      now += 10
      await lh.record(file, `v${i}`)
    }
    const res = await lh.list(file)
    expect(res.ok && res.versions.length).toBe(LH_KEEP)
    expect(readdirSync(lh.dirOf(file))).toHaveLength(LH_KEEP)
    now += LH_MAX_AGE_MS + 1
    expect(await lh.list(file)).toEqual({ ok: true, versions: [] })
    await lh.record(file, 'fresh')
    expect(readdirSync(lh.dirOf(file))).toHaveLength(1)
  })

  it('sweeps expired folders of other files once per run', async () => {
    let now = 1_800_000_000_000
    const data = path.join(tmp, 'd3')
    const old = new LocalHistory(data, { now: () => now })
    await old.record(path.join(tmp, 'other.ts'), 'x')
    now += LH_MAX_AGE_MS + 1
    const lh = new LocalHistory(data, { now: () => now })
    await lh.record(file, 'y')
    expect(readdirSync(path.join(data, 'history'))).toEqual([path.basename(lh.dirOf(file))])
  })

  it('skips binary and oversized text, refuses bad ids', async () => {
    const lh = new LocalHistory(path.join(tmp, 'd4'))
    await lh.record(file, 'a\0b')
    await lh.record(file, 'x'.repeat(LH_MAX_BYTES + 1))
    expect(await lh.list(file)).toEqual({ ok: true, versions: [] })
    for (const id of ['../x', '1800000000000/../../a', '', 'abc', 42, '1800000000000-1234']) {
      expect(isVersionId(id)).toBe(false)
      expect(await lh.read(file, id)).toEqual({ ok: false, error: 'denied' })
    }
    expect(await lh.read(file, '1800000000000')).toEqual({ ok: false, error: 'missing' })
  })
})

describe('writeTextFile onSaved', () => {
  it('passes the previous disk text after a save that changed the bytes', async () => {
    const root = path.join(tmp, 'w')
    mkdirSync(root, { recursive: true })
    const f = path.join(root, 'b.txt')
    writeFileSync(f, 'old\r\nline\r\n')
    const seen: Array<[string, string]> = []
    const onSaved = (real: string, prev: string) => void seen.push([real, prev])
    const res = await writeTextFile({ path: f, text: 'new\nline\n', expectedMtime: statSync(f).mtimeMs }, [root], { onSaved })
    expect(res.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]![1]).toBe('old\r\nline\r\n')
    await writeTextFile({ path: f, text: 'new\nline\n' }, [root], { onSaved })
    expect(seen).toHaveLength(1)
  })
})
