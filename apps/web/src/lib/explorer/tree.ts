/** Explorer tree model (ported from spacevibe-deck `files/file-tree.ts`): pure, no DOM, no bridge. */

export interface DirEntry {
  /** Leaf name as the filesystem reports it. */
  name: string
  /** Absolute path, already canonicalised by main. */
  path: string
  directory: boolean
  /** Symlink resolving outside the project: a leaf that never opens. */
  outOfRoot: boolean
}

export interface TreeRow {
  path: string
  name: string
  directory: boolean
  /** 0 = the root row, 1 = its children. */
  depth: number
  expanded: boolean
  outOfRoot: boolean
}

export type Listings = ReadonlyMap<string, readonly DirEntry[]>

/** Always hidden, even with "show hidden" on. A fixed list, not `.gitignore`. */
export const EXCLUDED_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules', 'dist', 'target'])

export const isHidden = (name: string): boolean => name.startsWith('.')

export const isVisible = (entry: DirEntry, showHidden: boolean): boolean => !EXCLUDED_NAMES.has(entry.name) && (showHidden || !isHidden(entry.name))

/** Folders first, then case-insensitive by name; code-unit tie-break keeps the order identical on every ICU build. */
export function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1
    const insensitive = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    if (insensitive) return insensitive
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

export const visibleEntries = (entries: readonly DirEntry[], showHidden: boolean): DirEntry[] => sortEntries(entries.filter((e) => isVisible(e, showHidden)))

export const canExpand = (entry: Pick<DirEntry, 'directory' | 'outOfRoot'>): boolean => entry.directory && !entry.outOfRoot

export function rootName(root: string): string {
  const cut = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'))
  return cut === -1 || cut === root.length - 1 ? root : root.slice(cut + 1)
}

/**
 * Rows a virtual list renders: the root row first, then a depth-first walk into expanded folders whose
 * listing has arrived. A folder is walked once, so a symlink cycle inside the root cannot loop.
 */
export function flattenTree(root: string, listings: Listings, expanded: ReadonlySet<string>, showHidden: boolean, rootExpanded: boolean): TreeRow[] {
  const rows: TreeRow[] = [{ path: root, name: rootName(root), directory: true, depth: 0, expanded: rootExpanded, outOfRoot: false }]
  const walked = new Set<string>()
  const walk = (dir: string, depth: number): void => {
    if (walked.has(dir)) return
    walked.add(dir)
    for (const entry of visibleEntries(listings.get(dir) ?? [], showHidden)) {
      const open = canExpand(entry) && expanded.has(entry.path)
      rows.push({ path: entry.path, name: entry.name, directory: entry.directory, depth, expanded: open, outOfRoot: entry.outOfRoot })
      if (open) walk(entry.path, depth + 1)
    }
  }
  if (rootExpanded) walk(root, 1)
  return rows
}

export function toggleExpanded(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded)
  if (!next.delete(path)) next.add(path)
  return next
}

/** Folders whose contents are on screen: what to (re)list and what a watch event may touch. */
export const openDirectories = (rows: readonly TreeRow[], root: string): string[] => [...new Set([root, ...rows.filter((r) => r.expanded).map((r) => r.path)])]

/** Index of `focused` in `rows`; a path that left the tree keeps its old index, clamped. Null = the root row. */
export function resolveFocusIndex(rows: readonly TreeRow[], focused: string | null, fallback: number): number {
  if (!rows.length || focused === null) return 0
  const found = rows.findIndex((r) => r.path === focused)
  return found !== -1 ? found : Math.min(Math.max(0, fallback), rows.length - 1)
}

export function parentDirectory(p: string): string {
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (cut <= 0) return p.slice(0, cut + 1) || p
  return /^[A-Za-z]:$/.test(p.slice(0, cut)) ? p.slice(0, cut + 1) : p.slice(0, cut)
}

/** Where New file / New folder create: the focused folder, else the focused row's folder, else the root. */
export function createTargetDirectory(rows: readonly TreeRow[], focused: string | null, root: string): string {
  const row = focused === null ? undefined : rows.find((r) => r.path === focused)
  if (!row || row.depth === 0) return root
  return canExpand(row) ? row.path : parentDirectory(row.path)
}

/** Path below `root` with '/' separators ('' for the root itself). */
export function relativeTo(root: string, p: string): string {
  const r = root.replace(/[\\/]+$/, '')
  if (p.length <= r.length) return ''
  return p.slice(r.length + 1).replace(/\\/g, '/')
}

export type FileGlyph = 'code' | 'json' | 'image' | 'text' | 'file'

const GLYPHS = new Map<string, FileGlyph>([
  ...['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'rs', 'py', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'rb', 'php', 'sh', 'ps1', 'css', 'scss', 'html', 'toml', 'yaml', 'yml', 'xml', 'sql'].map(
    (e): [string, FileGlyph] => [e, 'code'],
  ),
  ['json', 'json'],
  ...['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif'].map((e): [string, FileGlyph] => [e, 'image']),
  ...['md', 'mdx', 'txt', 'log', 'csv'].map((e): [string, FileGlyph] => [e, 'text']),
])

/** Glyph by extension; a dotfile (`.env`) has no extension. */
export function fileGlyph(name: string): FileGlyph {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? 'file' : (GLYPHS.get(name.slice(dot + 1).toLowerCase()) ?? 'file')
}
