import { isMac } from './platform'
import type { ChangeEntry } from './preview'

/** Shared by the Changes pane and the Explorer's Changes view. */
export const KIND_LETTER: Record<ChangeEntry['kind'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' }

export const KIND_CLASS: Record<ChangeEntry['kind'], string> = {
  modified: 'text-ink-muted',
  added: 'text-diff-add',
  untracked: 'text-diff-add',
  deleted: 'text-diff-del',
  renamed: 'text-ink-muted',
  conflict: 'text-warning',
}

export type ChangeGroupKey = 'conflicts' | 'changed' | 'untracked'

/** Conflicts, then changed, then untracked; empty groups dropped. */
export function groupChanges(entries: readonly ChangeEntry[]): { key: ChangeGroupKey; items: ChangeEntry[] }[] {
  const conflicts = entries.filter((e) => e.kind === 'conflict')
  const untracked = entries.filter((e) => e.kind === 'untracked')
  const changed = entries.filter((e) => e.kind !== 'conflict' && e.kind !== 'untracked')
  return (
    [
      { key: 'conflicts', items: conflicts },
      { key: 'changed', items: changed },
      { key: 'untracked', items: untracked },
    ] as { key: ChangeGroupKey; items: ChangeEntry[] }[]
  ).filter((g) => g.items.length)
}

const sep = (root: string): string => (root.includes('\\') ? '\\' : '/')

/** Repo-relative '/' path → absolute, in the root's own separator. */
export const absoluteIn = (root: string, rel: string): string => `${root.replace(/[\\/]$/, '')}${sep(root)}${rel.split('/').join(sep(root))}`

export const dirOfRel = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** Same folder/file, case-insensitive where the filesystem usually is. */
export const samePath = (a: string, b: string): boolean => (isMac || /^[A-Za-z]:/.test(a) ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b))
