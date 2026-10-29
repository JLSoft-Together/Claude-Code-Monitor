import { describe, expect, it } from 'vitest'
import type { CtxSource } from '@ccm/shared'
import { displayPath, groupSources, kb, startBytes } from './ctxSources'
import { rowMenu } from './rail/railMenu'

const f = (kind: CtxSource['kind'], load: CtxSource['load'], bytes: number, path = `/p/${kind}.md`): CtxSource => ({ kind, load, bytes, path })

describe('ctxSources', () => {
  it('groups files and sums only what every session reads', () => {
    const files = [f('user', 'start', 1000), f('import', 'start', 500), f('memory-index', 'start', 200), f('memory', 'on-demand', 9000), f('skill', 'listed', 4000)]
    expect(groupSources(files).map((g) => [g.id, g.files.length, g.startBytes])).toEqual([
      ['instructions', 2, 1500],
      ['memory', 2, 200],
      ['skills', 1, 0],
    ])
    expect(startBytes(files)).toBe(1700)
  })

  it('shows KB, never tokens', () => {
    expect(kb(0)).toBe('0.0')
    expect(kb(1536)).toBe('1.5')
    expect(kb(20 * 1024 + 700)).toBe('21')
  })

  it('shortens paths inside the folder or home', () => {
    expect(displayPath('C:\\work\\app\\CLAUDE.md', 'C:\\work\\app', 'C:\\Users\\me')).toBe('CLAUDE.md')
    expect(displayPath('c:\\users\\me\\.claude\\CLAUDE.md', 'C:\\work\\app', 'C:\\Users\\me')).toBe('~/.claude/CLAUDE.md')
    expect(displayPath('/etc/claude-code/CLAUDE.md', '/work/app', '/home/me')).toBe('/etc/claude-code/CLAUDE.md')
  })

  it('offers Background context on a Claude row with a folder', () => {
    const ctx = { tabRow: false, cwd: 'C:\\p', explorer: false, agent: true, linked: true, others: 0, targets: [] }
    const ids = (c: object) => rowMenu({ ...ctx, ...c }, (k) => k).map((e) => ('id' in e ? e.id : null))
    expect(ids({ context: true })).toContain('context')
    expect(ids({ context: false })).not.toContain('context')
    expect(ids({ context: true, cwd: null })).not.toContain('context')
  })
})
