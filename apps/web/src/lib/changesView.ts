import { isMac } from './platform'
import type { ChangeEntry } from './preview'

/** Shared by the Changes pane and the Explorer's Changes view. */
export const KIND_LETTER: Record<ChangeEntry['kind'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' }

export const KIND_CLASS: Record<ChangeEntry['kind'], string> = {
  modified: 'text-diff-mod',
  added: 'text-diff-add',
  untracked: 'text-diff-add',
  deleted: 'text-diff-del',
  renamed: 'text-diff-mod',
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

/** Map key for a path: separators unified, case folded where the filesystem usually ignores it. */
export const pathKey = (p: string): string => (isMac || /^[A-Za-z]:/.test(p) ? norm(p).toLowerCase() : norm(p))

export interface GitMarks {
  /** pathKey(absolute file) → kind. */
  files: Map<string, ChangeEntry['kind']>
  /** pathKey of every folder above a changed file (the repo root excluded). */
  dirs: Set<string>
}

/** Explorer colouring from one status read (IntelliJ file status highlights; parents marked too). */
export function gitMarks(root: string, entries: readonly ChangeEntry[]): GitMarks {
  const files = new Map<string, ChangeEntry['kind']>()
  const dirs = new Set<string>()
  for (const e of entries) {
    files.set(pathKey(absoluteIn(root, e.path)), e.kind)
    for (let d = dirOfRel(e.path); d; d = dirOfRel(d)) {
      const key = pathKey(absoluteIn(root, d))
      if (dirs.has(key)) break
      dirs.add(key)
    }
  }
  return { files, dirs }
}

/** "Show diff" from a list row: Ctrl+D (⌘⌥D on macOS, where ⌘D splits the pane). */
export const isShowDiffKey = (e: KeyboardEvent): boolean =>
  e.code === 'KeyD' && !e.shiftKey && (isMac ? e.metaKey && e.altKey && !e.ctrlKey : e.ctrlKey && !e.altKey && !e.metaKey)

/** ← / → without modifiers in a diff: previous / next file (Alt+← / → stays pane focus). */
export function fileStepKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 1 | -1 | 0 {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return 0
  return e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
}

/** Focus sits in a split side or another sideways scroller that overflows: ← / → scroll it instead of stepping files. */
export function inSidewaysScroller(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth <= n.clientWidth) continue
    if (n.matches('[data-side]')) return true
    const x = getComputedStyle(n).overflowX
    if (x === 'auto' || x === 'scroll') return true
  }
  return false
}
