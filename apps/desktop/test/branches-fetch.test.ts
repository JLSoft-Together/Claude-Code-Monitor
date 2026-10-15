import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[][] = []
let replies: { code: number; stderr: string }[] = []

vi.mock('../src/preview/gitExec', () => ({
  execGit: async (_cwd: string, args: string[]) => {
    calls.push(args)
    const r = replies.shift() ?? { code: 0, stderr: '' }
    return { code: r.code, stdout: '', stderr: r.stderr, truncated: false }
  },
}))

const { fetchAll } = await import('../src/preview/branches')

describe('fetchAll on old git', () => {
  beforeEach(() => {
    calls.length = 0
    replies = []
  })

  it('retries without --no-write-fetch-head when git does not know it', async () => {
    replies = [{ code: 129, stderr: "error: unknown option `no-write-fetch-head'\nusage: git fetch" }]
    expect(await fetchAll('/r')).toEqual({ ok: true })
    expect(calls).toEqual([
      ['fetch', '--all', '--no-write-fetch-head'],
      ['fetch', '--all'],
    ])
  })

  it('does not retry other failures', async () => {
    replies = [{ code: 1, stderr: 'fatal: could not read Username' }]
    expect(await fetchAll('/r')).toMatchObject({ ok: false, error: 'auth' })
    expect(calls).toHaveLength(1)
  })
})
