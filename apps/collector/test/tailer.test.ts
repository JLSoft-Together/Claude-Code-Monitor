import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const readLengths: number[] = []

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      const read = handle.read.bind(handle) as (...a: unknown[]) => ReturnType<typeof handle.read>
      return Object.assign(handle, {
        read: (buf: Buffer, offset: number, length: number, position: number) => {
          readLengths.push(length)
          return read(buf, offset, length, position)
        },
      })
    },
  }
})

const { JsonlTailer } = await import('../src/tailer')

describe('JsonlTailer chunked reads', () => {
  it('never reads more than one chunk at a time and keeps lines that span chunks', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ccm-chunk-'))
    const file = path.join(dir, 'a.jsonl')
    const lines = Array.from({ length: 50 }, (_, i) => JSON.stringify({ i, text: `dòng số ${i} ệ` }))
    await writeFile(file, lines.join('\n') + '\n')

    readLengths.length = 0
    const records = await new JsonlTailer(file, 16).read()

    expect(records).toEqual(lines.map((l) => JSON.parse(l)))
    expect(readLengths.length).toBeGreaterThan(1)
    expect(Math.max(...readLengths)).toBeLessThanOrEqual(16)
  })

  it('starts over when the file is truncated and rewritten', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ccm-chunk-'))
    const file = path.join(dir, 'a.jsonl')
    await writeFile(file, '{"a":1}\n{"b":2}\n{"c":3}\n')
    const t = new JsonlTailer(file, 5)
    expect(await t.read()).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
    await writeFile(file, '{"d":4}\n')
    expect(await t.read()).toEqual([{ d: 4 }])
  })
})
