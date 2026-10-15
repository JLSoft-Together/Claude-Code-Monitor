import { watch as fsWatch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { rootKey } from './paths'

export type ChangeListener = (root: string, changed: string[]) => void
type WatchFn = (root: string, options: { recursive: boolean }, listener: (event: string, file: string | Buffer | null) => void) => FSWatcher

// Build output and IDE state: a running build would otherwise wake every Changes pane and git status.
const IGNORED = new Set(['node_modules', '.git', 'build', '.gradle', '.dart_tool', 'dist', '.vitest', 'out', '.idea'])

const ignored = (rel: string): boolean => rel.split(/[\\/]/).some((part) => IGNORED.has(part))

interface Entry {
  root: string
  refs: number
  watcher: FSWatcher
  pending: Set<string>
  timer: NodeJS.Timeout | null
}

/** One recursive fs.watch per folder, shared by every pane showing something under it. */
export class RootWatcher {
  private entries = new Map<string, Entry>()
  private listener: ChangeListener | null

  constructor(
    listener: ChangeListener | null = null,
    private readonly opts: { debounceMs?: number; watch?: WatchFn; platform?: NodeJS.Platform } = {},
  ) {
    this.listener = listener
  }

  listen(listener: ChangeListener): void {
    this.listener = listener
  }

  has(root: string): boolean {
    return this.entries.has(this.key(root))
  }

  /** false when the folder cannot be watched (missing, permission). */
  add(root: string): boolean {
    const key = this.key(root)
    const known = this.entries.get(key)
    if (known) {
      known.refs++
      return true
    }
    let watcher: FSWatcher
    try {
      watcher = (this.opts.watch ?? (fsWatch as unknown as WatchFn))(root, { recursive: true }, (_event, file) => this.onEvent(key, file))
    } catch {
      return false
    }
    const entry: Entry = { root, refs: 1, watcher, pending: new Set(), timer: null }
    // Folder deleted or watch limit hit: stop quietly; the next add() starts over.
    watcher.on('error', () => this.drop(key))
    this.entries.set(key, entry)
    return true
  }

  remove(root: string): void {
    const key = this.key(root)
    const entry = this.entries.get(key)
    if (entry && --entry.refs <= 0) this.drop(key)
  }

  closeAll(): void {
    for (const key of [...this.entries.keys()]) this.drop(key)
  }

  private key(root: string): string {
    return rootKey(root, this.opts.platform)
  }

  private drop(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    if (entry.timer) clearTimeout(entry.timer)
    try {
      entry.watcher.close()
    } catch {
      // already closed
    }
  }

  private onEvent(key: string, file: string | Buffer | null): void {
    const entry = this.entries.get(key)
    if (!entry) return
    const rel = file ? String(file) : ''
    if (rel && ignored(rel)) return
    entry.pending.add(rel ? path.join(entry.root, rel) : entry.root)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      const changed = [...entry.pending]
      entry.pending.clear()
      if (this.entries.get(key) === entry) this.listener?.(entry.root, changed)
    }, this.opts.debounceMs ?? 150)
  }
}
