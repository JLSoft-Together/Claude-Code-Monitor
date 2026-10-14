import type { ChangeEntry } from './preview'

export type ChangesTreeRow =
  | { kind: 'dir'; path: string; name: string; depth: number; count: number; expanded: boolean }
  | { kind: 'file'; entry: ChangeEntry; depth: number }

interface Dir {
  dirs: Map<string, Dir>
  files: ChangeEntry[]
  count: number
}

const byName = (a: string, b: string): number => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : a < b ? -1 : a > b ? 1 : 0)
const fileName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)

/**
 * Changed files grouped by folder (IntelliJ "Group by directory"): folders first, chains of folders with a single
 * sub-folder and no files shown as one row `a/b/c`. `collapsed` holds folder paths (repo-relative) the user closed.
 */
export function changesTree(entries: readonly ChangeEntry[], collapsed: ReadonlySet<string> = new Set()): ChangesTreeRow[] {
  const root: Dir = { dirs: new Map(), files: [], count: 0 }
  for (const e of entries) {
    const parts = e.path.split('/')
    parts.pop()
    let at = root
    at.count++
    for (const p of parts) {
      let next = at.dirs.get(p)
      if (!next) at.dirs.set(p, (next = { dirs: new Map(), files: [], count: 0 }))
      next.count++
      at = next
    }
    at.files.push(e)
  }
  const rows: ChangesTreeRow[] = []
  const walk = (dir: Dir, prefix: string, depth: number): void => {
    for (const name of [...dir.dirs.keys()].sort(byName)) {
      let node = dir.dirs.get(name)!
      let label = name
      let path = prefix ? `${prefix}/${name}` : name
      while (node.files.length === 0 && node.dirs.size === 1) {
        const [child, sub] = [...node.dirs.entries()][0]!
        label += `/${child}`
        path += `/${child}`
        node = sub
      }
      const expanded = !collapsed.has(path)
      rows.push({ kind: 'dir', path, name: label, depth, count: node.count, expanded })
      if (expanded) walk(node, path, depth + 1)
    }
    for (const e of [...dir.files].sort((a, b) => byName(fileName(a.path), fileName(b.path)))) rows.push({ kind: 'file', entry: e, depth })
  }
  walk(root, '', 0)
  return rows
}
