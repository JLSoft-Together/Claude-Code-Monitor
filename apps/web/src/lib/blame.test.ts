import { describe, expect, it } from 'vitest'
import { blameRows } from './blame'

describe('blameRows', () => {
  it('labels the first line of each run and marks uncommitted lines', () => {
    const a = 'a'.repeat(40)
    const rows = blameRows({ ok: true, root: '/r', commits: { [a]: { author: 'Ann', time: Date.UTC(2026, 9, 1), summary: 'fix it' } }, lines: [a, a, '', a] }, 'en-GB', 'Not committed')
    expect(rows.map((r) => r.text)).toEqual([expect.stringMatching(/^Ann · \d\d\/\d\d\/\d\d$/), '', 'Not committed', expect.stringMatching(/^Ann/)])
    expect(rows[0]!.title).toMatch(/^aaaaaaaa fix it\nAnn/)
    expect(rows[2]!.hash).toBe('')
  })
})
