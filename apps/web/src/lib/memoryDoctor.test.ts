import { describe, expect, it } from 'vitest'
import type { MemFinding } from '@ccm/shared'
import { doctorPrompt, groupFindings, PROMPT_MAX } from './memoryDoctor'

const f = (file: string, line: number, kind: MemFinding['kind'], text: string, extra: Partial<MemFinding> = {}): MemFinding => ({ file, line, kind, text, openable: true, ...extra })

describe('memory doctor (page)', () => {
  const list = [
    f('C:/p/CLAUDE.md', 3, 'missing-path', 'apps/x.ts'),
    f('C:/h/.claude/projects/p/memory/a.md', 7, 'broken-link', 'ghost'),
    f('C:/p/CLAUDE.md', 1, 'too-large', '41000', { limit: 40000 }),
  ]

  it('groups by file with short paths', () => {
    const groups = groupFindings(list, 'C:/p', 'C:/h')
    expect(groups.map((g) => [g.shown, g.findings.length])).toEqual([
      ['CLAUDE.md', 2],
      ['~/.claude/projects/p/memory/a.md', 1],
    ])
  })

  it('builds a capped cleanup prompt', () => {
    const text = doctorPrompt(list, 'C:/p', 'C:/h')!
    expect(text.split('\n').slice(1)).toEqual([
      '- CLAUDE.md:3 — mentions apps/x.ts, which no longer exists in the project',
      '- ~/.claude/projects/p/memory/a.md:7 — [[ghost]] points to no memory',
      '- CLAUDE.md:1 — 41000 characters (over 40000)',
    ])
    expect(text).toContain('Ask before deleting')
    expect(doctorPrompt([], 'C:/p', null)).toBeNull()
    const many = Array.from({ length: 400 }, (_, i) => f(`C:/p/m${i}.md`, 1, 'not-indexed', `m${i}.md`))
    const long = doctorPrompt(many, 'C:/p', null)!
    expect(long.length).toBeLessThanOrEqual(PROMPT_MAX + 40)
    expect(long).toMatch(/… \d+ more$/)
  })
})
