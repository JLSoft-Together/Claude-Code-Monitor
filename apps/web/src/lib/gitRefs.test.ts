import { describe, expect, it } from 'vitest'
import { labelText, parseDecorations, refTree, type RefsOk } from './gitRefs'

describe('parseDecorations', () => {
  it('splits HEAD, local, remote and tags and merges a local with its remote', () => {
    const labels = parseDecorations('HEAD -> main, origin/main, origin/HEAD, tag: v1.0, feature/x', ['origin'])
    expect(labels).toEqual([
      { kind: 'local', name: 'main', current: true, remote: 'origin' },
      { kind: 'tag', name: 'v1.0' },
      { kind: 'local', name: 'feature/x' },
    ])
    expect(labelText(labels[0]!)).toBe('origin & main')
  })

  it('handles a detached HEAD and remote-only branches', () => {
    expect(parseDecorations('HEAD, origin/dev', ['origin'])).toEqual([
      { kind: 'head', name: 'HEAD', current: true },
      { kind: 'remote', name: 'origin/dev' },
    ])
    expect(parseDecorations('', ['origin'])).toEqual([])
  })
})

const refs: RefsOk = {
  ok: true,
  root: '/r',
  head: { branch: 'main', hash: 'a'.repeat(40) },
  local: [
    { ref: 'refs/heads/main', name: 'main', hash: 'a', upstream: 'origin/main', ahead: 1, behind: 0, gone: false },
    { ref: 'refs/heads/feature/x', name: 'feature/x', hash: 'b', upstream: null, ahead: 0, behind: 0, gone: false },
  ],
  remotes: [{ name: 'origin', refs: [{ ref: 'refs/remotes/origin/main', name: 'origin/main', hash: 'a' }] }],
  tags: [{ ref: 'refs/tags/v1', name: 'v1', hash: 'a' }],
  me: 'Ann',
}

describe('refTree', () => {
  it('lists HEAD, local folders, remotes and tags', () => {
    const rows = refTree(refs, '', new Set())
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'ref' ? r.leaf : r.kind === 'folder' ? `${r.name}/` : r.section}`)).toEqual([
      'head',
      'local',
      '  main',
      '  feature/',
      '    x',
      'remote',
      '  origin/',
      '    main',
      'tags',
      '  v1',
    ])
    const main = rows.find((r) => r.kind === 'ref' && r.ref === 'refs/heads/main')
    expect(main).toMatchObject({ current: true, tracked: true, ahead: 1 })
  })

  it('filters case-insensitively and hides collapsed folders', () => {
    expect(refTree(refs, 'FEAT', new Set()).filter((r) => r.kind === 'ref').map((r) => (r as { name: string }).name)).toEqual(['feature/x'])
    const collapsed = refTree(refs, '', new Set(['local']))
    expect(collapsed.some((r) => r.kind === 'ref' && r.refKind === 'local')).toBe(false)
  })
})
