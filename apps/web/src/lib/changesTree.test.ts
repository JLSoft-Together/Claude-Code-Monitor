import { describe, expect, it } from 'vitest'
import { changesTree, type ChangesTreeRow } from './changesTree'
import type { ChangeEntry } from './preview'

const entry = (path: string): ChangeEntry => ({ path, x: '.', y: 'M', kind: 'modified', staged: false })
const show = (rows: ChangesTreeRow[]) => rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'dir' ? `${r.name}/ (${r.count})` : r.entry.path}`)

describe('changesTree', () => {
  it('groups by folder, folders first, compressing single-child chains', () => {
    const rows = changesTree(['README.md', 'apps/web/src/a.ts', 'apps/web/src/lib/b.ts', 'apps/desktop/c.ts', 'Z.md'].map(entry))
    expect(show(rows)).toEqual([
      'apps/ (3)',
      '  desktop/ (1)',
      '    apps/desktop/c.ts',
      '  web/src/ (2)',
      '    lib/ (1)',
      '      apps/web/src/lib/b.ts',
      '    apps/web/src/a.ts',
      'README.md',
      'Z.md',
    ])
  })

  it('hides the files of a collapsed folder', () => {
    const rows = changesTree(['a/x.ts', 'a/y.ts', 'b.ts'].map(entry), new Set(['a']))
    expect(show(rows)).toEqual(['a/ (2)', 'b.ts'])
    expect(rows[0]).toMatchObject({ kind: 'dir', expanded: false })
  })
})
